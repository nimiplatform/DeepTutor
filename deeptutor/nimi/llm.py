"""Adapt DeepTutor model steps to its typed Host business protocol."""

from __future__ import annotations

from contextlib import aclosing
import base64
import json
from typing import Any

from deeptutor.services.llm.exceptions import LLMConfigError, LLMProviderError
from deeptutor.services.llm.provider_core.base import (
    GenerationSettings,
    LLMProvider,
    LLMResponse,
    ToolCallRequest,
)

from .transport import get_transport


def _pipe_output(item, *, decode=False):
    if item["type"] != "reasoning-continuity":
        return item
    carrier = item["carrier"]
    payload = carrier["payload"]
    payload = list(base64.b64decode(payload, validate=True)) if decode else base64.b64encode(bytes(payload)).decode("ascii")
    return {**item, "carrier": {**carrier, "payload": payload}}


def model_request(messages, tools=None, tool_choice=None, response_format=None, **parameters):
    declared = {item["function"]["name"]: item for item in tools or []}
    converted = []
    calls = {}
    for message in messages:
        role = message["role"]
        state = (message.get("_provider_response_state") or {}).get("nimi_state") or message.get(
            "_nimi_state"
        )
        content = message.get("content") or ""
        if role == "assistant":
            if state:
                outputs = state["output_items"]
                called_names = {
                    item["toolCall"]["name"] for item in outputs if item["type"] == "tool-call"
                }
                for tool in state.get("tools", []):
                    if tool["function"]["name"] in called_names:
                        declared.setdefault(tool["function"]["name"], tool)
            else:
                outputs = [{"type": "text", "text": content}] if content else []
                for call in message.get("tool_calls", []):
                    outputs.append(
                        {
                            "type": "tool-call",
                            "toolCall": {
                                "id": call["id"],
                                "name": call["function"]["name"],
                                "arguments": json.loads(call["function"]["arguments"] or "{}"),
                            },
                        }
                    )
            for item in outputs:
                if item["type"] == "tool-call":
                    calls[item["toolCall"]["id"]] = item["toolCall"]["name"]
            if outputs:
                converted.append(
                    {
                        "role": "assistant",
                        "content": [],
                        "turnItems": [{"type": "output", "output": item} for item in outputs],
                    }
                )
        elif role == "tool":
            call_id = message["tool_call_id"]
            if call_id not in calls:
                raise LLMProviderError(
                    "A tool result lost its matching model call during context assembly."
                )
            converted.append(
                {
                    "role": "tool",
                    "content": [],
                    "turnItems": [
                        {
                            "type": "tool-result",
                            "toolResult": {
                                "toolCallId": call_id,
                                "toolName": calls[call_id],
                                "result": content,
                                "isError": bool(message.get("is_error", False)),
                            },
                        }
                    ],
                }
            )
        elif role in {"system", "user"}:
            if isinstance(content, str):
                parts = [{"type": "text", "text": content}]
            else:
                parts = []
                for part in content:
                    if part["type"] == "text":
                        parts.append({"type": "text", "text": part["text"]})
                    elif part["type"] == "image_url":
                        url = part["image_url"]["url"]
                        if url.startswith("data:"):
                            raise LLMProviderError(
                                "Local image attachment upload is not yet connected to Nimi. The image has not been dropped."
                            )
                        parts.append({"type": "file", "mediaType": "image/png", "data": url})
                    else:
                        raise LLMProviderError(f"Unsupported model input part: {part['type']}")
            if role == "system" and converted and converted[-1]["role"] == "system":
                converted[-1]["content"].append({"type": "text", "text": "\n\n"})
                converted[-1]["content"].extend(parts)
            elif parts and any(p.get("text", "").strip() or p["type"] != "text" for p in parts):
                converted.append({"role": role, "content": parts})
        else:
            raise LLMProviderError(f"Unsupported message role: {role}")
    request: dict[str, Any] = {"messages": converted, "parameters": parameters}
    if declared:
        request["tools"] = [
            {
                "type": "function",
                "name": item["function"]["name"],
                "description": item["function"].get("description", ""),
                "inputSchema": item["function"].get(
                    "parameters", {"type": "object", "properties": {}}
                ),
            }
            for item in declared.values()
        ]
    if tool_choice is not None:
        request["toolChoice"] = (
            {"type": "tool", "name": tool_choice["function"]["name"]}
            if isinstance(tool_choice, dict)
            else tool_choice
        )
    if declared and not tools:
        # Historical declarations are required for replay, but do not enable
        # calls in an App step that has no active tools.
        if tool_choice not in (None, "auto", "none"):
            raise LLMConfigError("Tool choice requires an active tool declaration.")
        request["toolChoice"] = "none"
    if response_format:
        kind = response_format["type"]
        if kind == "json_schema":
            schema = response_format["json_schema"]
            request["responseFormat"] = {"type": "json-schema", **schema}
        elif kind == "json_object":
            request["responseFormat"] = {"type": "json-object"}
        elif kind == "text":
            request["responseFormat"] = {"type": "text"}
        else:
            raise LLMProviderError(f"Unsupported response format: {kind}")
    return request, list(declared.values())


class NimiLLMProvider(LLMProvider):
    generation = GenerationSettings()

    def get_default_model(self):
        return "text.generate"

    async def aclose(self):
        # The supervised Host owns the shared connection, not this model handle.
        return None

    async def chat(self, messages, **kwargs):
        return await self.chat_stream(messages, **kwargs)

    async def chat_with_retry(self, messages, **kwargs):
        kwargs.pop("retry_delays", None)
        kwargs.pop("allow_image_fallback", None)
        return await self.chat(messages, **kwargs)

    async def chat_stream_with_retry(self, messages, **kwargs):
        kwargs.pop("retry_delays", None)
        kwargs.pop("allow_image_fallback", None)
        return await self.chat_stream(messages, **kwargs)

    async def chat_stream(
        self,
        messages,
        tools=None,
        model=None,
        max_tokens=None,
        temperature=None,
        reasoning_effort=None,
        tool_choice=None,
        on_content_delta=None,
        on_reasoning_delta=None,
        **kwargs,
    ):
        if model not in {None, "text.generate"}:
            raise LLMConfigError("Choose the text model in Nimi App AIConfig.")
        if reasoning_effort is not None:
            raise LLMConfigError(
                "Independent reasoning effort is not exposed by this Nimi text binding."
            )
        response_format = kwargs.pop("response_format", None)
        # Omitted controls belong to Runtime's configured route. Explicit
        # caller/task controls are retained and may be refused by that route.
        parameters = {}
        if max_tokens is not None:
            parameters["maxTokens"] = max_tokens
        if temperature is not None:
            parameters["temperature"] = temperature
        for old, new in {
            "top_p": "topP",
            "top_k": "topK",
            "presence_penalty": "presencePenalty",
            "frequency_penalty": "frequencyPenalty",
            "stop": "stop",
            "seed": "seed",
        }.items():
            if old in kwargs:
                parameters[new] = kwargs.pop(old)
        if kwargs:
            raise LLMConfigError(
                f"Unsupported Nimi model step options: {', '.join(sorted(kwargs))}"
            )
        request, declarations = model_request(
            messages, tools, tool_choice, response_format, **parameters
        )
        request = {**request, "messages": [{**message, **({"turnItems": [
            {**item, "output": _pipe_output(item["output"])} if item["type"] == "output" else item
            for item in message["turnItems"]]} if "turnItems" in message else {})} for message in request["messages"]]}
        async with aclosing(get_transport().events("text.step", request)) as events:
            async for frame in events:
                if frame["kind"] == "delta" and on_content_delta:
                    await on_content_delta(frame["value"]["text"])
                elif frame["kind"] == "result":
                    result = frame["value"]
                    called_names = {call["name"] for call in result["toolCalls"]}
                    replay_tools = [
                        tool for tool in declarations if tool["function"]["name"] in called_names
                    ]
                    return LLMResponse(
                        content=result["text"],
                        tool_calls=[
                            ToolCallRequest(
                                id=call["id"], name=call["name"], arguments=call["arguments"]
                            )
                            for call in result["toolCalls"]
                        ],
                        finish_reason=result["finishReason"].replace("-", "_"),
                        provider_specific_fields={
                            "nimi_state": {
                                "output_items": [_pipe_output(item, decode=True) for item in result["outputItems"]],
                                "tools": replay_tools,
                            }
                        },
                    )
        raise LLMProviderError("Nimi model step ended without success.")

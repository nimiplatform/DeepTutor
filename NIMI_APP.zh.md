# DeepTutor（Nimi 桌面版）

DeepTutor 是一款面向文献研读、难题推演、结构化笔记与学习任务管理的本地优先 AI 学习工作台，由 Nimi 统一提供账号登录、应用授权与 AI 模型调度。

## 核心能力

- **本地知识库与引用问答**：在「知识中心」导入 PDF、Markdown 等学习资料，通过 Nimi 向量模型构建本地索引，围绕原文献开展带引用来源与原文预览的严谨问答。
- **深度解题与多阶段学习**：支持 LaTeX 公式渲染、分步解题推演、多阶段深度研究与可视化讲解，帮助你拆解数学、科研与工程难题。
- **笔记本、协同写作与任务看板**：一键将关键问答沉淀到笔记本，在 Co-Writer 中整理实验报告或课程长文，在任务看板追踪复习进度，并支持导出为标准 Markdown。
- **可选多模态能力**：按需接入 Nimi 配置的语音朗读、麦克风语音转写以及图像、视频生成工具。

## 在 PC 上快速开始

1. 在 Windows（x64）或 macOS（Apple Silicon）的 **Nimi Home** 中打开 DeepTutor，并保持 Nimi 处于运行状态。
2. 在对话底部打开 **Nimi 模型**，或进入 **设置 → 模型与服务** 配置所需模型：
   - **文本模型（`text.generate`）**：对话辅导、深度解题、研究与写作必需。
   - **向量模型（`text.embed`）**：知识中心文档索引与引用检索必需。
   - **可选多模态模型**：`audio.synthesize`（朗读）、`audio.transcribe`（语音输入）、`image.generate`（生图）与 `video.generate`（视频）。
3. 直接发起学习对话，或在 **知识中心** 导入并完成资料索引后，选择该知识库进行带来源引用的问答。
4. 将有价值的推导保存到 **笔记本**，在 **Co-Writer** 组织长文，或在 **任务看板** 规划学习节点，并可随时导出为 Markdown。

## 运行环境与模型说明

- DeepTutor 在你的本地 PC 上运行，所有 AI 请求严格遵循你在 Nimi 中选择的本地（Local）或云端（Cloud）模型配置。
- 请选择支持当前任务能力的模型；若所选模型拒绝请求，应用会直接提示错误，不会静默替换为其他模型。
- 更换向量模型（`text.embed`）后，需要重新索引已有知识库再执行检索问答。

## 数据去向与当前限制

- **本地 PC 留存**：对话记录、上传文献、向量索引、笔记本、Co-Writer 文档、阅读工作区、任务卡片、日程与应用设置全部保存在本机 `<Nimi data root>/app-hosts/*/apps/*/user-data/workspace/**` 目录。通过 Nimi 卸载应用仅移除受管程序包，不会自动删除你的个人学习工作区，需由你自行清理。
- **模型请求数据流**：使用 Nimi 本地模型时推理完全在本机完成；使用云端模型时，仅将当次提问所需的上下文、检索片段或附件发送至你在 Nimi 中选定的服务商。
- **版本号显示**：应用内「关于」徽章显示上游 DeepTutor 核心版本（`1.7.4`），Nimi Home 显示 Nimi 应用包版本（`1.6.20`）。
- **可选外部工具**：网页搜索服务凭据、本地 CLI 子代理及 Manim/FFmpeg 动画渲染需在你的 PC 上自行配置，未配置前不可用。
- **网页远程访问说明**：DeepTutor `1.6.20` 已在 PC 端就绪工作区协作接口（`deeptutor.workspace.v3`），但本原生版本尚未包含已公开发布的托管网页入口。后续网页版单独发布并经 Registry 准入后，仍需你的 PC 运行 `1.6.20` 及以上版本桌面端并在 Nimi Home 完成来源确认与协作授权。

## 帮助与开源许可

DeepTutor 遵循 Apache-2.0 许可协议，基于上游项目 [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor) 适配至 Nimi 平台（适配仓库：[nimiplatform/DeepTutor](https://github.com/nimiplatform/DeepTutor)）。问题反馈与帮助请访问 [GitHub Issues](https://github.com/nimiplatform/DeepTutor/issues)。

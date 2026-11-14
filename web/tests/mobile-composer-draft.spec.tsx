import { createRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ComposerInput, type ComposerInputHandle } from '@/components/chat/home/ComposerInput';
import { bindMobileDrafts, endMobileDrafts } from '@/shared/storage/mobile-drafts';

vi.mock('react-i18next',()=>({useTranslation:()=>({t:(value:string)=>value})}));
afterEach(()=>endMobileDrafts());

it('a new document restores typed mobile input without submitting and clears it only on the normal send action',async()=>{
  const drafts:Record<string,unknown>={'chat:one:text':'Unsubmitted learning question'};
  const send=vi.fn(), changed=vi.fn();
  const bind=()=>bindMobileDrafts({...drafts},(key,value)=>{drafts[key]=value;});
  const mount=()=>render(<ComposerInput mobileDraftKey="chat:one:text" ref={createRef<ComposerInputHandle>()}
    textareaRef={createRef<HTMLTextAreaElement>()} isVisualizeMode={false} canSendEmpty={false}
    onSend={send} onInputChange={changed} onPaste={()=>{}}
    selectedCounts={{attachments:0,knowledge:0,chatHistory:0,myAgents:0,books:0,reading:0,notebooks:0,questionBank:0,persona:0,memory:0}}
    knowledgeAvailable={false} personaAvailable={false} onSelectAttach={()=>{}} onSelectNotebookPicker={()=>{}}
    onSelectBookPicker={()=>{}} onSelectHistoryPicker={()=>{}} onSelectQuestionBankPicker={()=>{}}
    onSelectPersonaPicker={()=>{}} onSelectMemoryPicker={()=>{}}/>);
  bind();const first=mount();
  expect(screen.getByRole('textbox')).toHaveValue('Unsubmitted learning question');
  expect(changed).toHaveBeenCalledWith('Unsubmitted learning question');expect(send).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'Keep this wording'}});
  await waitFor(()=>expect(drafts['chat:one:text']).toBe('Keep this wording'));
  first.unmount();endMobileDrafts();bind();mount();
  expect(screen.getByRole('textbox')).toHaveValue('Keep this wording');expect(send).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('textbox'),{key:'Enter',code:'Enter'});
  expect(send).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledWith('Keep this wording');
  await waitFor(()=>expect(drafts['chat:one:text']).toBe(''));
});

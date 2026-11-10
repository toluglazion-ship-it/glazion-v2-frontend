import type { SavedRow } from '@glazion/api-client/recipes';
import type { SendMessageRequest, Umf } from '@glazion/types';
import type { SearchForm } from './searchForm';

// One screen leaving something for the next one to pick up: the calculator's recipe for search, a past
// search to edit, or a question about a tile for chat to send. Taken once, then cleared.

export interface SearchStart {
  /** The calculator's recipe, base then colorants, so the search keeps its stains as well as its oxides. */
  rows?: SavedRow[];
  /** A UMF to start from, when there are no rows. */
  umf?: Umf;
  cone: string;
}

let searchStart: SearchStart | null = null;
let searchToEdit: SearchForm | null = null;
let chatQuestion: SendMessageRequest | null = null;

export const handoff = {
  startSearch(start: SearchStart) {
    searchStart = start;
  },
  takeSearchStart(): SearchStart | null {
    const value = searchStart;
    searchStart = null;
    return value;
  },
  editSearch(form: SearchForm) {
    searchToEdit = form;
  },
  takeSearchToEdit(): SearchForm | null {
    const value = searchToEdit;
    searchToEdit = null;
    return value;
  },
  askInChat(question: SendMessageRequest) {
    chatQuestion = question;
  },
  takeQuestion(): SendMessageRequest | null {
    const value = chatQuestion;
    chatQuestion = null;
    return value;
  },
};

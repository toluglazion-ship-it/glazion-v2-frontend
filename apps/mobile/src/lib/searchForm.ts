import AsyncStorage from '@react-native-async-storage/async-storage';
import { getStoredUser } from '@glazion/api-client';

// The Find tiles form as it was left, kept on this phone per account so it survives the app being
// closed, and the firing of the last search, to start the next one from.

export interface FormRow {
  material: string;
  materialId: string | null;
  picked: boolean;
  amount: string;
}

export interface SearchForm {
  mode: 'recipe' | 'umf';
  rows: FormRow[];
  umf: Record<string, string>;
  coneFrom: string;
  coneTo: string;
  atmosphere: string;
  strict: boolean;
  variants: string[];
  surfaces: string[];
  colours: string[];
  clayBodies: string[];
}

export type Firing = Pick<SearchForm, 'coneFrom' | 'coneTo' | 'atmosphere'>;

const account = () => getStoredUser()?.id ?? 'guest';

async function read<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function write(key: string, value: unknown) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the form still holds while the app is open.
  }
}

export const searchDraft = {
  read: () => read<SearchForm>(`glazion_search_draft_${account()}`),
  write: (form: SearchForm) => write(`glazion_search_draft_${account()}`, form),
};

export const lastFiring = {
  read: () => read<Firing>(`glazion_last_firing_${account()}`),
  write: (firing: Firing) => write(`glazion_last_firing_${account()}`, firing),
};

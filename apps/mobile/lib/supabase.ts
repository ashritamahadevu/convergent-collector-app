import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra ?? {};

const supabaseUrl = extra.supabaseUrl as string | undefined;
const supabasePublishableKey = extra.supabasePublishableKey as string | undefined;

if (!supabaseUrl || !supabasePublishableKey) {
  console.warn(
    'Supabase env missing. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
  );
}

export const supabase = createClient(
  supabaseUrl ?? 'http://127.0.0.1:54321',
  supabasePublishableKey ?? 'placeholder-key',
);

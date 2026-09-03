import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { Session, User } from '@supabase/supabase-js';
import api from '@/lib/api';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: any | null;
  loading: boolean;
  initialize: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  profile: null,
  loading: true,
  initialize: async () => {
    // Recupera la sessione JWT
    const { data: { session } } = await supabase.auth.getSession();
    let profile = null;
    
    if (session) {
      try {
        // Fetch del profilo dal backend (tabella 'user' per tenant_id, ruolo, colore, ecc.)
        const resp = await api.get('/api/auth/me'); // Aggiusto il path
        profile = resp.data;
      } catch (e) {
        console.error('Errore nel caricamento del profilo DB:', e);
      }
    }
    
    set({ session, user: session?.user || null, profile, loading: false });
    
    // Ascolta i cambiamenti di stato (login, logout, token refresh)
    supabase.auth.onAuthStateChange(async (_event, currentSession) => {
      let currentProfile = null;
      if (currentSession) {
        try {
          // Quando c'è un nuovo login, il token è stato appena settato e verrà intercettato
          const resp = await api.get('/api/auth/me');
          currentProfile = resp.data;
        } catch (e) {
          console.error('Errore nel caricamento del profilo DB on auth change:', e);
        }
      }
      set({ session: currentSession, user: currentSession?.user || null, profile: currentProfile, loading: false });
    });
  },
  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, profile: null });
  }
}));

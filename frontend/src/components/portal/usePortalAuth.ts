import { useState } from 'react';
import type React from 'react';
import { clientLoginApi, magicLoginApi, cambiaPasswordClienteApi } from '../../api/client';

/**
 * Hook React con gli stati di autenticazione del portale cliente (credenziali,
 * magic link e gestione della password personale) e i quattro handler collegati.
 */

interface UsePortalAuthArgs {
  /** Thunk di ricarica dei dati del portale, invocata dopo un login riuscito. */
  loadPortalData: (clienteId?: string) => Promise<void>;
  /** Anagrafica del cliente autenticato, usata da `handleSaveClientPassword`. */
  clientObj: any;
  setClientObj: (valore: any) => void;
}

export function usePortalAuth({ loadPortalData, clientObj, setClientObj }: UsePortalAuthArgs): {
  isAuthenticated: boolean;
  setIsAuthenticated: (valore: boolean) => void;
  accessoNegato: string | null;
  setAccessoNegato: (valore: string | null) => void;
  loginEmail: string;
  setLoginEmail: (valore: string) => void;
  loginPassword: string;
  setLoginPassword: (valore: string) => void;
  loginLoading: boolean;
  loginError: string | null;
  setLoginError: (valore: string | null) => void;
  authMode: 'credentials' | 'magic';
  setAuthMode: (mode: 'credentials' | 'magic') => void;
  manualMagicToken: string;
  setManualMagicToken: (valore: string) => void;
  clientPassCurrent: string;
  setClientPassCurrent: (valore: string) => void;
  clientPassNew: string;
  setClientPassNew: (valore: string) => void;
  clientPassConfirm: string;
  setClientPassConfirm: (valore: string) => void;
  clientPassShow: boolean;
  setClientPassShow: (valore: boolean) => void;
  clientPassLoading: boolean;
  clientPassMsg: { text: string; type: 'success' | 'error' } | null;
  handleClientLogin: (e: React.FormEvent) => Promise<void>;
  handleClientLogout: () => void;
  handleManualMagicSubmit: (e: React.FormEvent) => Promise<void>;
  handleSaveClientPassword: (e: React.FormEvent) => Promise<void>;
} {
  // Stati di autenticazione per Portale Cliente (Email + Password e Magic Link)
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'credentials' | 'magic'>('credentials');
  const [manualMagicToken, setManualMagicToken] = useState('');

  // Stati Gestione Password Personale Cliente
  const [clientPassCurrent, setClientPassCurrent] = useState('');
  const [clientPassNew, setClientPassNew] = useState('');
  const [clientPassConfirm, setClientPassConfirm] = useState('');
  const [clientPassShow, setClientPassShow] = useState(false);
  const [clientPassLoading, setClientPassLoading] = useState(false);
  const [clientPassMsg, setClientPassMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [accessoNegato, setAccessoNegato] = useState<string | null>(null);

  const handleClientLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!loginEmail || !loginPassword) {
      setLoginError('Inserisci sia email che password');
      return;
    }
    setLoginLoading(true);
    try {
      const res = await clientLoginApi(loginEmail.trim(), loginPassword);
      if (res && res.token) {
        localStorage.setItem('bluman_portal_token', res.token);
        if (res.user) {
          localStorage.setItem('bluman_client_user', JSON.stringify(res.user));
        }
        setIsAuthenticated(true);
        setAccessoNegato(null);
        await loadPortalData(res.user?.clienteId);
      } else {
        setLoginError('Credenziali non valide o utente non trovato');
      }
    } catch (err: any) {
      setLoginError(err.message || 'Credenziali non valide');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleClientLogout = () => {
    localStorage.removeItem('bluman_portal_token');
    localStorage.removeItem('bluman_client_user');
    setIsAuthenticated(false);
  };

  const handleManualMagicSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!manualMagicToken.trim()) {
      setLoginError('Inserisci un Magic Token valido');
      return;
    }
    setLoginLoading(true);
    try {
      const sessione = await magicLoginApi(manualMagicToken.trim());
      if (!sessione?.token) throw new Error('Magic Token non valido o scaduto');
      localStorage.setItem('bluman_portal_token', sessione.token);
      if (sessione.user) {
        localStorage.setItem('bluman_client_user', JSON.stringify(sessione.user));
      }
      setIsAuthenticated(true);
      setAccessoNegato(null);
      await loadPortalData(sessione.user?.clienteId);
    } catch (err: any) {
      setLoginError(err.message || 'Magic Token non valido o scaduto');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSaveClientPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setClientPassMsg(null);
    if (clientPassNew.length < 6) {
      setClientPassMsg({ text: 'La nuova password deve contenere almeno 6 caratteri.', type: 'error' });
      return;
    }
    if (clientPassNew !== clientPassConfirm) {
      setClientPassMsg({ text: 'Le due password non coincidono.', type: 'error' });
      return;
    }
    setClientPassLoading(true);
    try {
      await cambiaPasswordClienteApi(clientPassNew, clientPassCurrent, clientObj?.id, clientObj?.email || loginEmail);
      setClientPassMsg({ text: '✓ Password salvata con successo! Ora puoi accedere al portale anche con la tua email e questa password.', type: 'success' });
      setClientPassCurrent('');
      setClientPassNew('');
      setClientPassConfirm('');
      if (clientObj) {
        setClientObj({ ...clientObj, hasPassword: true });
      }
    } catch (err: any) {
      setClientPassMsg({ text: err.message || 'Errore durante il salvataggio della password', type: 'error' });
    } finally {
      setClientPassLoading(false);
    }
  };

  return {
    isAuthenticated,
    setIsAuthenticated,
    accessoNegato,
    setAccessoNegato,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    loginLoading,
    loginError,
    setLoginError,
    authMode,
    setAuthMode,
    manualMagicToken,
    setManualMagicToken,
    clientPassCurrent,
    setClientPassCurrent,
    clientPassNew,
    setClientPassNew,
    clientPassConfirm,
    setClientPassConfirm,
    clientPassShow,
    setClientPassShow,
    clientPassLoading,
    clientPassMsg,
    handleClientLogin,
    handleClientLogout,
    handleManualMagicSubmit,
    handleSaveClientPassword,
  };
}

import { useCallback, useEffect, useState } from 'react';
import { fetchFormMasterApi, type FormMaster } from '../api/formMaster';

/**
 * I form dello studio, letti dal server. `form === null` = lettura in corso; `errore` = lettura
 * fallita (non «nessun form»); `ricarica` rilegge dopo una creazione, un'eliminazione o un errore.
 */
export function useFormMaster() {
  const [form, setForm] = useState<FormMaster[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const ricarica = useCallback(async () => {
    setErrore(null);
    try {
      setForm(await fetchFormMasterApi());
    } catch (err) {
      setForm([]);
      setErrore(err instanceof Error ? err.message : 'Errore di rete');
    }
  }, []);

  useEffect(() => {
    void ricarica();
  }, [ricarica]);

  return { form, errore, ricarica };
}

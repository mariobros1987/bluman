import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchTutteFattureStudioApi,
  createInvoiceApi,
  emettiInvoiceApi,
  emettiNotaCreditoApi,
  deleteInvoiceApi,
  registraIncassoApi,
  downloadFatturaPdfServerApi,
  downloadFatturaXmlApi,
  inviaFatturaEmailApi,
  fetchClienti,
  fetchProgetti,
  fetchContiBancariApi,
  importFromProjectApi,
  importFromTimesheetApi,
} from '../api/client';
import { fmt } from '../utils';

export function InvoicesPage() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [clienti, setClienti] = useState<any[]>([]);
  const [progetti, setProgetti] = useState<any[]>([]);
  const [contiBancari, setContiBancari] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStato, setFilterStato] = useState('tutte');
  const [searchTerm, setSearchTerm] = useState('');

  // Modali
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showIncassoModal, setShowIncassoModal] = useState(false);
  const [showNcModal, setShowNcModal] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form Nuova Fattura State
  const [clienteId, setClienteId] = useState('');
  const [progettoId, setProgettoId] = useState('');
  const [condizionePagamento, setCondizionePagamento] = useState('bonifico_30gg');
  const [metodoPagamento, setMetodoPagamento] = useState('bonifico');
  const [contoAccreditoId, setContoAccreditoId] = useState('');
  const [tipoCassa, setTipoCassa] = useState('nessuna');
  const [aliquotaCassa, setAliquotaCassa] = useState(4);
  const [aliquotaRitenuta, setAliquotaRitenuta] = useState(20);
  const [esigibilitaIva, setEsigibilitaIva] = useState('immediata');
  const [note, setNote] = useState('');

  // Righe Fattura
  const [righe, setRighe] = useState<any[]>([
    {
      descrizione: 'Consulenza Direzionale & Assistenza Operativa',
      quantita: 1,
      unitaMisura: 'forfait',
      prezzoUnitarioCent: 150000,
      scontoPercentuale: 0,
      aliquotaIva: 22,
      naturaEsenzione: '',
      applicaCassa: true,
      applicaRitenuta: true,
      applicaBollo: false,
    },
  ]);

  // Form Incasso Rata State
  const [selectedScadenza, setSelectedScadenza] = useState<any>(null);
  const [importoIncassoEur, setImportoIncassoEur] = useState('');
  const [metodoIncasso, setMetodoIncasso] = useState('bonifico');
  const [croIncasso, setCroIncasso] = useState('');
  const [noteIncasso, setNoteIncasso] = useState('');

  // Form Nota di Credito State
  const [motivoNc, setMotivoNc] = useState('annullo_totale');
  const [noteNc, setNoteNc] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [invData, clData, prData, cbData] = await Promise.all([
        fetchTutteFattureStudioApi(),
        fetchClienti(),
        fetchProgetti(),
        fetchContiBancariApi(),
      ]);
      setInvoices(invData || []);
      setClienti(clData || []);
      setProgetti(prData || []);
      setContiBancari(cbData || []);
    } catch (err) {
      console.warn('Errore caricamento registro fatture:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Calcolo Totali Real-Time nel Form
  const calcolaTotaliForm = () => {
    let totImponibileCent = 0;
    let totIvaCent = 0;
    let totSoggetteCassaCent = 0;
    let totSoggetteRitenutaCent = 0;
    let totEsenteCent = 0;

    righe.forEach((r) => {
      const pUnit = r.prezzoUnitarioCent || 0;
      const qta = r.quantita || 1;
      const sconto = r.scontoPercentuale || 0;
      const nettoRiga = Math.round(pUnit * qta * (1 - sconto / 100));
      totImponibileCent += nettoRiga;

      if (r.applicaCassa && tipoCassa !== 'nessuna') {
        totSoggetteCassaCent += nettoRiga;
      }
      if (r.applicaRitenuta) {
        totSoggetteRitenutaCent += nettoRiga;
      }

      if (r.aliquotaIva === 0) {
        totEsenteCent += nettoRiga;
      }
    });

    const cassaCent = tipoCassa !== 'nessuna' ? Math.round(totSoggetteCassaCent * (aliquotaCassa / 100)) : 0;

    righe.forEach((r) => {
      if (r.aliquotaIva > 0) {
        const pUnit = r.prezzoUnitarioCent || 0;
        const qta = r.quantita || 1;
        const sconto = r.scontoPercentuale || 0;
        const nettoRiga = Math.round(pUnit * qta * (1 - sconto / 100));
        totIvaCent += Math.round(nettoRiga * (r.aliquotaIva / 100));
      }
    });
    if (cassaCent > 0) {
      totIvaCent += Math.round(cassaCent * 0.22);
    }

    const ritenutaCent = Math.round(totSoggetteRitenutaCent * (aliquotaRitenuta / 100));
    const bolloCent = totEsenteCent > 7747 ? 200 : 0; // €2,00 se esente > €77,47
    const totaleDocumentoCent = totImponibileCent + cassaCent + totIvaCent + bolloCent;
    const nettoAPagareCent = totaleDocumentoCent - ritenutaCent;

    return {
      totImponibileCent,
      cassaCent,
      totIvaCent,
      ritenutaCent,
      bolloCent,
      totaleDocumentoCent,
      nettoAPagareCent,
    };
  };

  const totaliForm = calcolaTotaliForm();

  // Handlers Creazione & Importazione
  const handleAggiungiRiga = () => {
    setRighe([
      ...righe,
      {
        descrizione: 'Nuova prestazione / articolo',
        quantita: 1,
        unitaMisura: 'forfait',
        prezzoUnitarioCent: 50000,
        scontoPercentuale: 0,
        aliquotaIva: 22,
        naturaEsenzione: '',
        applicaCassa: true,
        applicaRitenuta: true,
        applicaBollo: false,
      },
    ]);
  };

  const handleRimuoviRiga = (index: number) => {
    if (righe.length === 1) return;
    setRighe(righe.filter((_, idx) => idx !== index));
  };

  const handleAggiornaRiga = (index: number, campo: string, valore: any) => {
    const nuoveRighe = [...righe];
    nuoveRighe[index] = { ...nuoveRighe[index], [campo]: valore };
    setRighe(nuoveRighe);
  };

  const handleImportDaProgetto = async () => {
    if (!progettoId) {
      alert('Seleziona prima un progetto associato');
      return;
    }
    try {
      const res = await importFromProjectApi(progettoId);
      if (res.righeSuggerite && res.righeSuggerite.length > 0) {
        setRighe(res.righeSuggerite);
        if (res.cliente?.id) setClienteId(res.cliente.id);
        alert(`✓ Importati ${res.righeSuggerite.length} moduli dal progetto!`);
      }
    } catch (err: any) {
      alert(`Errore importazione: ${err.message}`);
    }
  };

  const handleImportDaTimesheet = async () => {
    if (!progettoId) {
      alert('Seleziona prima un progetto per importare le ore del timesheet');
      return;
    }
    try {
      const res = await importFromTimesheetApi(progettoId);
      if (res.righeSuggerite && res.righeSuggerite.length > 0) {
        setRighe(res.righeSuggerite);
        alert(`✓ Importate ${res.oreConsuntivate} ore consuntivate dal timesheet!`);
      }
    } catch (err: any) {
      alert(`Errore importazione: ${err.message}`);
    }
  };

  const handleSalvaFattura = async (emettiSubito: boolean) => {
    if (!clienteId) {
      alert('Seleziona il cliente committente');
      return;
    }
    if (righe.length === 0) {
      alert('Aggiungi almeno una prestazione o articolo');
      return;
    }

    setSubmitting(true);
    try {
      const nuovaFattura = await createInvoiceApi({
        clienteId,
        progettoId: progettoId || undefined,
        condizionePagamento,
        metodoPagamento,
        contoAccreditoId: contoAccreditoId || undefined,
        tipoCassa,
        aliquotaCassa,
        aliquotaRitenuta,
        esigibilitaIva,
        note: note || undefined,
        righe,
      });

      if (emettiSubito && nuovaFattura?.id) {
        await emettiInvoiceApi(nuovaFattura.id);
      }

      setShowCreateModal(false);
      await loadData();
      alert(emettiSubito ? '✓ Fattura emessa definitivamente con successo!' : '✓ Bozza salvata con successo nel registro!');
    } catch (err: any) {
      alert(`Errore salvataggio fattura: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmettiDefinitivo = async (fattura: any) => {
    if (!confirm(`Confermi l'emissione definitiva della fattura ${fattura.numero}? Verrà generato il numero ufficiale progressivo e il piano rate nello scadenzario.`)) return;
    try {
      await emettiInvoiceApi(fattura.id);
      await loadData();
      alert(`✓ Fattura emessa con successo!`);
    } catch (err: any) {
      alert(`Errore: ${err.message}`);
    }
  };

  const handleEmettiNotaCredito = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice) return;
    setSubmitting(true);
    try {
      await emettiNotaCreditoApi(selectedInvoice.id, {
        motivo: motivoNc,
        note: noteNc || undefined,
      });
      setShowNcModal(false);
      await loadData();
      alert('✓ Nota di credito (TD04) emessa con successo a storno della fattura!');
    } catch (err: any) {
      alert(`Errore emissione nota di credito: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegistraIncasso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedScadenza || !importoIncassoEur) return;
    const importoCent = Math.round(parseFloat(importoIncassoEur) * 100);

    setSubmitting(true);
    try {
      await registraIncassoApi(selectedScadenza.id, {
        importoIncassatoCentesimi: importoCent,
        metodoPagamento: metodoIncasso,
        riferimentoTransazione: croIncasso || undefined,
        noteOperatore: noteIncasso || undefined,
      });
      setShowIncassoModal(false);
      await loadData();
      alert('✓ Incasso registrato con successo e movimento scritto automaticamente in Prima Nota!');
    } catch (err: any) {
      alert(`Errore registrazione incasso: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEliminaBozza = async (id: string) => {
    if (!confirm('Sei sicuro di voler eliminare questa bozza di fattura?')) return;
    try {
      await deleteInvoiceApi(id);
      await loadData();
    } catch (err: any) {
      alert(`Errore eliminazione: ${err.message}`);
    }
  };

  // Metriche
  const totalEmessoCent = invoices.filter((f) => f.tipoDocumento === 'fattura' && f.stato !== 'bozza').reduce((acc, f) => acc + (f.totaleDocumentoCentesimi || 0), 0);
  const totalIncassatoCent = invoices.filter((f) => f.tipoDocumento === 'fattura' && f.stato === 'incassata').reduce((acc, f) => acc + (f.totaleDocumentoCentesimi || 0), 0);
  const totalSospesoCent = invoices.filter((f) => f.tipoDocumento === 'fattura' && f.stato === 'emessa').reduce((acc, f) => acc + (f.totaleDocumentoCentesimi || 0), 0);
  const totalNcCent = invoices.filter((f) => f.tipoDocumento === 'nota_credito').reduce((acc, f) => acc + (f.totaleDocumentoCentesimi || 0), 0);

  const filteredInvoices = invoices.filter((f) => {
    if (filterStato !== 'tutte' && f.stato !== filterStato) return false;
    const searchString = `${f.numero} ${f.cliente?.nome || ''} ${f.progetto?.nome || ''}`.toLowerCase();
    if (searchTerm && !searchString.includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Registro Fatture & SDI Elettronica</h2>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0 0', fontSize: 14 }}>
            Emissione fatture conformi SDI FatturaPA 1.2, note di credito TD04, scadenze rate ed archivio PDF
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => {
              if (invoices.length === 0) {
                alert('Nessuna fattura presente nel registro da esportare.');
                return;
              }
              const headers = ['Tipo Documento', 'Numero', 'Data', 'Cliente', 'Imponibile (€)', 'IVA (€)', 'Ritenuta (€)', 'Totale Doc (€)', 'Netto a Pagare (€)', 'Stato'];
              const rows = invoices.map((inv) => {
                const isNote = inv.tipoDocumento === 'nota_credito';
                return [
                  isNote ? 'Nota di Credito (TD04)' : 'Fattura Elettronica (TD01)',
                  inv.numero || `FT-${inv.numeroProgressivoSerie}`,
                  inv.data ? new Date(inv.data).toLocaleDateString('it-IT') : new Date().toLocaleDateString('it-IT'),
                  `"${(inv.cliente?.nome || 'Cliente').replace(/"/g, '""')}"`,
                  `${isNote ? '-' : ''}${((inv.totaleImponibileCentesimi || 0) / 100).toFixed(2)}`,
                  `${isNote ? '-' : ''}${((inv.totaleIvaCentesimi || 0) / 100).toFixed(2)}`,
                  `${isNote ? '-' : ''}${((inv.totaleRitenutaCentesimi || 0) / 100).toFixed(2)}`,
                  `${isNote ? '-' : ''}${((inv.totaleDocumentoCentesimi || 0) / 100).toFixed(2)}`,
                  `${isNote ? '-' : ''}${((inv.nettoAPagareCentesimi || 0) / 100).toFixed(2)}`,
                  inv.stato.toUpperCase(),
                ];
              });
              const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n');
              const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.setAttribute('href', url);
              link.setAttribute('download', `Registro_Fatture_Commercialista_${new Date().toISOString().slice(0, 10)}.csv`);
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);
            }}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #1e40af',
              background: '#1e3a8a',
              color: '#93c5fd',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            📊 Export Commercialista (CSV / Excel)
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--primary)',
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            + Nuova Fattura / Bozza
          </button>
        </div>
      </div>

      {/* KPI STRIP */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: '2rem' }}>
        <div style={{ background: '#1e3a8a', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: '#93c5fd', textTransform: 'uppercase', fontWeight: 600 }}>Totale Fatturato Emesso</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>💶 {fmt(totalEmessoCent / 100)}</div>
        </div>
        <div style={{ background: '#064e3b', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: '#6ee7b7', textTransform: 'uppercase', fontWeight: 600 }}>Incassato Saldate</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>✓ {fmt(totalIncassatoCent / 100)}</div>
        </div>
        <div style={{ background: '#78350f', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: '#fcd34d', textTransform: 'uppercase', fontWeight: 600 }}>In Sospeso / Da Incassare</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>⏳ {fmt(totalSospesoCent / 100)}</div>
        </div>
        <div style={{ background: '#451a03', padding: 20, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: '#fca5a5', textTransform: 'uppercase', fontWeight: 600 }}>Note di Credito Emesse</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'white', marginTop: 8 }}>📉 {fmt(totalNcCent / 100)}</div>
        </div>
      </div>

      {/* FILTRI & TABELLA FATTURE */}
      <div style={{ background: 'var(--card)', borderRadius: 12, padding: '1.5rem', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Cerca per numero fattura, cliente o incarico..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', flex: 1, minWidth: 200 }}
          />
          <select
            value={filterStato}
            onChange={(e) => setFilterStato(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: 180 }}
          >
            <option value="tutte">Tutti gli stati</option>
            <option value="bozza">Bozze (In compilazione)</option>
            <option value="emessa">Emesse (Da Incassare)</option>
            <option value="incassata">Incassate (Saldate)</option>
            <option value="annullata">Annullate (Stornate)</option>
          </select>
        </div>

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Caricamento registro fatture dal database...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 8px' }}>Documento</th>
                <th style={{ padding: '12px 8px' }}>Data</th>
                <th style={{ padding: '12px 8px' }}>Cliente / Progetto</th>
                <th style={{ padding: '12px 8px' }}>Imponibile</th>
                <th style={{ padding: '12px 8px' }}>Totale Doc</th>
                <th style={{ padding: '12px 8px' }}>Netto a Pagare</th>
                <th style={{ padding: '12px 8px' }}>Stato Fiscale</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Azioni Documento</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
                    Nessun documento trovato nel registro.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => {
                  const isNote = inv.tipoDocumento === 'nota_credito';
                  const isBozza = inv.stato === 'bozza';
                  const isEmessa = inv.stato === 'emessa';
                  const isIncassata = inv.stato === 'incassata';

                  const badgeColor = isBozza
                    ? { bg: '#374151', text: '#d1d5db', label: 'BOZZA' }
                    : isEmessa
                    ? { bg: '#78350f', text: '#fcd34d', label: 'DA INCASSARE' }
                    : isIncassata
                    ? { bg: '#064e3b', text: '#6ee7b7', label: 'SALDATA' }
                    : { bg: '#7f1d1d', text: '#fca5a5', label: 'ANNULLATA' };

                  return (
                    <tr key={inv.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '14px 8px', fontWeight: 600 }}>
                        <div style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, background: isNote ? '#7f1d1d' : '#1e3a8a', color: 'white', fontSize: 11, marginRight: 8 }}>
                          {isNote ? 'NC' : 'FT'}
                        </div>
                        {inv.numero || `FT-${inv.numeroProgressivoSerie}`}
                      </td>
                      <td style={{ padding: '14px 8px', color: 'var(--muted)', fontSize: 13 }}>
                        {inv.data ? new Date(inv.data).toLocaleDateString('it-IT') : new Date().toLocaleDateString('it-IT')}
                      </td>
                      <td style={{ padding: '14px 8px' }}>
                        <div style={{ fontWeight: 600 }}>{inv.cliente?.nome || inv.progetto?.cliente?.nome || 'Cliente Studio'}</div>
                        {inv.progetto?.nome && <div style={{ fontSize: 12, color: 'var(--primary)' }}>📁 {inv.progetto.nome}</div>}
                      </td>
                      <td style={{ padding: '14px 8px', fontSize: 13, color: 'var(--muted)' }}>
                        {fmt((inv.totaleImponibileCentesimi || 0) / 100)}
                      </td>
                      <td style={{ padding: '14px 8px', fontWeight: 600 }}>
                        {fmt((inv.totaleDocumentoCentesimi || 0) / 100)}
                      </td>
                      <td style={{ padding: '14px 8px', fontWeight: 700, color: isNote ? '#fca5a5' : '#34d399' }}>
                        {isNote ? '-' : ''} {fmt((inv.nettoAPagareCentesimi || inv.totaleDocumentoCentesimi || 0) / 100)}
                      </td>
                      <td style={{ padding: '14px 8px' }}>
                        <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: badgeColor.bg, color: badgeColor.text }}>
                          {badgeColor.label}
                        </span>
                      </td>
                      <td style={{ padding: '14px 8px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {/* Scarica PDF */}
                          <button
                            onClick={() => downloadFatturaPdfServerApi(inv.id, inv.numero)}
                            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 12 }}
                            title="Scarica PDF Ufficiale"
                          >
                            📄 PDF
                          </button>

                          {/* Scarica XML SDI */}
                          <button
                            onClick={() => downloadFatturaXmlApi(inv.id, inv.numero)}
                            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #1e40af', background: '#1e3a8a', color: '#93c5fd', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                            title="Scarica tracciato XML FatturaPA 1.2 conforme"
                          >
                            📦 XML SDI
                          </button>

                          {/* Invia Email */}
                          <button
                            onClick={() => {
                              const dest = prompt('Inserisci email destinatario:', inv.cliente?.email || '');
                              if (dest) inviaFatturaEmailApi(inv.id, dest);
                            }}
                            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 12 }}
                            title="Invia PDF per Email"
                          >
                            ✉️ Email
                          </button>

                          {/* Apri in Document Studio */}
                          {inv.progettoId && (
                            <button
                              onClick={() => navigate(`/documents?projId=${inv.progettoId}&tmplId=tmpl-avviso-parcella`)}
                              style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 12 }}
                              title="Apri modello Avviso di Parcella / Proforma in Document Studio per questo progetto"
                            >
                              📝 Proforma
                            </button>
                          )}

                          {/* Se Bozza: Emetti o Elimina */}
                          {isBozza && (
                            <>
                              <button
                                onClick={() => handleEmettiDefinitivo(inv)}
                                style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: '#059669', color: 'white', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                                title="Emetti definitivamente e genera scadenze"
                              >
                                🚀 Emetti
                              </button>
                              <button
                                onClick={() => handleEliminaBozza(inv.id)}
                                style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: '#7f1d1d', color: '#fca5a5', cursor: 'pointer', fontSize: 12 }}
                                title="Elimina bozza"
                              >
                                🗑️
                              </button>
                            </>
                          )}

                          {/* Se Emessa: Registra Incasso o Nota Credito */}
                          {isEmessa && (
                            <>
                              {inv.scadenzeIncasso && inv.scadenzeIncasso.length > 0 && (
                                <button
                                  onClick={() => {
                                    const scadAperta = inv.scadenzeIncasso.find((s: any) => s.stato !== 'incassato') || inv.scadenzeIncasso[0];
                                    setSelectedInvoice(inv);
                                    setSelectedScadenza(scadAperta);
                                    setImportoIncassoEur(((scadAperta.importoCentesimi || 0) / 100).toFixed(2));
                                    setShowIncassoModal(true);
                                  }}
                                  style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: '#047857', color: 'white', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                                  title="Registra incasso rata"
                                >
                                  📥 Incasso
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  setSelectedInvoice(inv);
                                  setShowNcModal(true);
                                }}
                                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #dc2626', background: '#7f1d1d', color: '#fca5a5', cursor: 'pointer', fontSize: 12 }}
                                title="Emetti Nota di Credito TD04"
                              >
                                🔄 NC
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* MODAL CREAZIONE FATTURA / BOZZA */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: 'var(--card)', borderRadius: 16, padding: '2rem', width: '100%', maxWidth: 900, maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0 }}>Nuova Fattura Professionale / Bozza</h3>
              <button onClick={() => setShowCreateModal(false)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>

            {/* SELEZIONE CLIENTE & PROGETTO */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: '1rem' }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Cliente Committente *</label>
                <select
                  value={clienteId}
                  onChange={(e) => setClienteId(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                >
                  <option value="">Seleziona cliente dall'anagrafica...</option>
                  {clienti.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} {c.piva ? `(P.IVA: ${c.piva})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Progetto / Incarico Collegato</label>
                <select
                  value={progettoId}
                  onChange={(e) => setProgettoId(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                >
                  <option value="">Nessuno / Fattura libera</option>
                  {progetti.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome} ({p.cliente?.nome || 'Cliente'})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* QUICK IMPORT SORGENTE */}
            {progettoId && (
              <div style={{ display: 'flex', gap: 10, padding: 12, borderRadius: 8, background: 'var(--bg)', border: '1px dashed var(--primary)', marginBottom: '1.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Importazione Automatica:</span>
                <button
                  type="button"
                  onClick={handleImportDaProgetto}
                  style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--primary)', background: '#1e3a8a', color: '#93c5fd', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  📥 Importa Moduli Progetto
                </button>
                <button
                  type="button"
                  onClick={handleImportDaTimesheet}
                  style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--primary)', background: '#1e3a8a', color: '#93c5fd', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  ⏱️ Importa Ore Timesheet
                </button>
              </div>
            )}

            {/* RIGHE TABELLA PRESTAZIONI */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h4 style={{ margin: 0, fontSize: 14 }}>Dettaglio Prestazioni & Articoli</h4>
                <button
                  type="button"
                  onClick={handleAggiungiRiga}
                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, cursor: 'pointer' }}
                >
                  + Aggiungi Riga
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {righe.map((r, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1.5fr 1fr 40px', gap: 8, alignItems: 'center', background: 'var(--bg)', padding: 8, borderRadius: 8 }}>
                    <input
                      type="text"
                      placeholder="Descrizione prestazione..."
                      value={r.descrizione}
                      onChange={(e) => handleAggiornaRiga(idx, 'descrizione', e.target.value)}
                      style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }}
                    />
                    <input
                      type="number"
                      placeholder="Q.tà"
                      value={r.quantita}
                      onChange={(e) => handleAggiornaRiga(idx, 'quantita', parseFloat(e.target.value) || 1)}
                      style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }}
                    />
                    <input
                      type="text"
                      placeholder="U.M. (ore/forfait)"
                      value={r.unitaMisura}
                      onChange={(e) => handleAggiornaRiga(idx, 'unitaMisura', e.target.value)}
                      style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }}
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Prezzo Unit (€)"
                      value={(r.prezzoUnitarioCent / 100).toFixed(2)}
                      onChange={(e) => handleAggiornaRiga(idx, 'prezzoUnitarioCent', Math.round(parseFloat(e.target.value) * 100) || 0)}
                      style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }}
                    />
                    <select
                      value={r.aliquotaIva}
                      onChange={(e) => handleAggiornaRiga(idx, 'aliquotaIva', parseInt(e.target.value, 10))}
                      style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }}
                    >
                      <option value={22}>IVA 22%</option>
                      <option value={10}>IVA 10%</option>
                      <option value={4}>IVA 4%</option>
                      <option value={0}>Esente IVA (0%)</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => handleRimuoviRiga(idx)}
                      style={{ background: 'transparent', border: 'none', color: '#ef4444', fontSize: 16, cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* OPZIONI FISCALI & CONDIZIONI */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: '1.5rem', background: 'var(--bg)', padding: 12, borderRadius: 8 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Cassa Previdenziale</label>
                <select
                  value={tipoCassa}
                  onChange={(e) => {
                    setTipoCassa(e.target.value);
                    if (e.target.value === 'nessuna') setAliquotaCassa(0);
                    else setAliquotaCassa(4);
                  }}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }}
                >
                  <option value="nessuna">Nessuna Cassa</option>
                  <option value="inps_gestione_separata">INPS Gestione Separata (4%)</option>
                  <option value="cassa_commercialisti">Cassa Dottori Commercialisti (4%)</option>
                  <option value="cassa_forense">Cassa Forense (4%)</option>
                  <option value="inarcassa">Inarcassa (4%)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Ritenuta d'Acconto</label>
                <select
                  value={aliquotaRitenuta}
                  onChange={(e) => setAliquotaRitenuta(parseInt(e.target.value, 10))}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }}
                >
                  <option value={20}>Ritenuta 20% (Professionisti)</option>
                  <option value={0}>Nessuna Ritenuta (0%)</option>
                  <option value={23}>Ritenuta 23% (Agenti)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Condizione Pagamento</label>
                <select
                  value={condizionePagamento}
                  onChange={(e) => setCondizionePagamento(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }}
                >
                  <option value="bonifico_30gg">Bonifico 30 gg D.F.</option>
                  <option value="immediato">Immediato / Rimessa Diretta</option>
                  <option value="bonifico_60gg">Bonifico 60 gg D.F.</option>
                  <option value="bonifico_30_60gg">Bonifico 30/60 gg (2 Rate)</option>
                  <option value="bonifico_fine_mese">Bonifico Fine Mese</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Metodo Pagamento</label>
                <select
                  value={metodoPagamento}
                  onChange={(e) => setMetodoPagamento(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }}
                >
                  <option value="bonifico">Bonifico Bancario</option>
                  <option value="carta">Carta di Credito</option>
                  <option value="contanti">Contanti</option>
                  <option value="assegno">Assegno</option>
                  <option value="stripe">Stripe</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Esigibilità IVA</label>
                <select
                  value={esigibilitaIva}
                  onChange={(e) => setEsigibilitaIva(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }}
                >
                  <option value="immediata">Immediata (Standard)</option>
                  <option value="differita">IVA ad Esigibilità Differita</option>
                  <option value="split">Split Payment (P.A.)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Conto Accredito IBAN</label>
                <select
                  value={contoAccreditoId}
                  onChange={(e) => setContoAccreditoId(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }}
                >
                  <option value="">Conto Predefinito Studio</option>
                  {contiBancari.map((cb) => (
                    <option key={cb.id} value={cb.id}>
                      {cb.nomeConto} ({cb.iban || cb.banca})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Note in Fattura / Coordinate / Riferimenti</label>
                <textarea
                  rows={2}
                  placeholder="Note facoltative da mostrare nel documento PDF..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }}
                />
              </div>
            </div>

            {/* BREAKDOWN FINANZIARIO */}
            <div style={{ background: '#0f172a', padding: '1.25rem', borderRadius: 10, marginBottom: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, border: '1px solid #1e293b' }}>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Imponibile</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'white' }}>{fmt(totaliForm.totImponibileCent / 100)}</div>
              </div>
              {totaliForm.cassaCent > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Cassa Prev. (4%)</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'white' }}>+ {fmt(totaliForm.cassaCent / 100)}</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>IVA</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'white' }}>+ {fmt(totaliForm.totIvaCent / 100)}</div>
              </div>
              {totaliForm.ritenutaCent > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: '#f87171' }}>Ritenuta (20%)</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#f87171' }}>- {fmt(totaliForm.ritenutaCent / 100)}</div>
                </div>
              )}
              {totaliForm.bolloCent > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: '#fcd34d' }}>Bollo Virtuale</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fcd34d' }}>+ € 2,00</div>
                </div>
              )}
              <div style={{ borderLeft: '2px solid #334155', paddingLeft: 12 }}>
                <div style={{ fontSize: 11, color: '#34d399', fontWeight: 700 }}>NETTO A PAGARE</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#34d399' }}>{fmt(totaliForm.nettoAPagareCent / 100)}</div>
              </div>
            </div>

            {/* BOTTONI AZIONE */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSalvaFattura(false)}
                style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontWeight: 600, cursor: 'pointer' }}
              >
                💾 Salva Bozza
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSalvaFattura(true)}
                style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: 'white', fontWeight: 700, cursor: 'pointer' }}
              >
                🚀 Emetti Definitivamente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL REGISTRAZIONE INCASSO RATA */}
      {showIncassoModal && selectedScadenza && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: 'var(--card)', borderRadius: 16, padding: '2rem', width: '100%', maxWidth: 480, border: '1px solid var(--border)' }}>
            <h3 style={{ margin: '0 0 1rem 0' }}>Registrazione Incasso Rata #{selectedScadenza.numeroRata}</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 1.25rem 0' }}>
              Fattura: <strong>{selectedInvoice?.numero}</strong> | Cliente: <strong>{selectedInvoice?.cliente?.nome}</strong>
            </p>

            <form onSubmit={handleRegistraIncasso} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Importo Incassato (€) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={importoIncassoEur}
                  onChange={(e) => setImportoIncassoEur(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 16, fontWeight: 700 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Metodo Incasso</label>
                <select
                  value={metodoIncasso}
                  onChange={(e) => setMetodoIncasso(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                >
                  <option value="bonifico">Bonifico Bancario</option>
                  <option value="carta">Carta di Credito</option>
                  <option value="contanti">Contanti</option>
                  <option value="assegno">Assegno</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>CRO / Riferimento Transazione Bancaria</label>
                <input
                  type="text"
                  placeholder="Es. CRO-123456789"
                  value={croIncasso}
                  onChange={(e) => setCroIncasso(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Note Operatore (Opzionale)</label>
                <input
                  type="text"
                  placeholder="Es. Ricevuta bonifico verificata..."
                  value={noteIncasso}
                  onChange={(e) => setNoteIncasso(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowIncassoModal(false)}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#059669', color: 'white', fontWeight: 700, cursor: 'pointer' }}
                >
                  {submitting ? 'Registrazione...' : 'Conferma Incasso & Scrivi in Prima Nota'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL NOTA DI CREDITO */}
      {showNcModal && selectedInvoice && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: 'var(--card)', borderRadius: 16, padding: '2rem', width: '100%', maxWidth: 480, border: '1px solid var(--border)' }}>
            <h3 style={{ margin: '0 0 1rem 0' }}>Emissione Nota di Credito (TD04)</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 1.25rem 0' }}>
              Storno a fronte della fattura <strong>{selectedInvoice.numero}</strong> per un importo di <strong>{fmt((selectedInvoice.totaleDocumentoCentesimi || 0) / 100)}</strong>
            </p>

            <form onSubmit={handleEmettiNotaCredito} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Motivo Emissione Nota di Credito</label>
                <select
                  value={motivoNc}
                  onChange={(e) => setMotivoNc(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                >
                  <option value="annullo_totale">Annullo Totale Documento</option>
                  <option value="errore_esposizione">Errore Esposizione Dati Fisc/Prezzi</option>
                  <option value="reso_merce">Reso / Incarico non erogato</option>
                  <option value="sconto_post_fattura">Sconto / Abbuono post-fatturazione</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Note Operative / Giustificativo</label>
                <textarea
                  rows={3}
                  placeholder="Es. Storno totale per rifacimento fattura con dati corretti..."
                  value={noteNc}
                  onChange={(e) => setNoteNc(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowNcModal(false)}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#dc2626', color: 'white', fontWeight: 700, cursor: 'pointer' }}
                >
                  {submitting ? 'Emissione...' : 'Emetti Nota di Credito Ufficiale'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

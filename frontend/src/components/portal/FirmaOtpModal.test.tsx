import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FirmaOtpModal, type FirmaOtpModalProps } from './FirmaOtpModal';

function props(): FirmaOtpModalProps {
  return {
    livelloFirma: 'fea', otpCanale: 'email', setOtpCanale: vi.fn(),
    canaliFirma: [], canaliCaricati: true,
    nomeCanale: { email: 'Email', whatsapp: 'WhatsApp', telegram: 'Telegram', signal: 'Signal' },
    otpLoading: false, otpTarget: '', otpTargetDichiarato: false,
    otpValiditaSecondi: 120, otpCode: '', setOtpCode: vi.fn(),
    otpError: null, setOtpError: vi.fn(), loading: false,
    otpReinviiRimanenti: 2, otpAttesaReinvio: 0,
    inviaCodiceFirma: vi.fn().mockResolvedValue(true), confermaFirmaConOtp: vi.fn().mockResolvedValue(true),
    setPadGrafometricaAperto: vi.fn(), firmatariAmmessi: ['Firmatario test A', 'Firmatario test B'],
    firmatarioSelezionato: 'Firmatario test A', setFirmatarioSelezionato: vi.fn(),
    onCaricaDocRiconoscimento: vi.fn(), docRiconoscimentoNome: null,
    onRimuoviDocRiconoscimento: vi.fn(), onClose: vi.fn(),
  };
}

describe('Firma OTP — campi accessibili', () => {
  it('permette di trovare firmatario, documento e OTP senza usare il placeholder', () => {
    const p = props();
    render(<FirmaOtpModal {...p} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Chi sta firmando' }), { target: { value: 'Firmatario test B' } });
    expect(p.setFirmatarioSelezionato).toHaveBeenCalledWith('Firmatario test B');
    const file = new File(['test'], 'documento-test.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Documento di riconoscimento'), { target: { files: [file] } });
    expect(p.onCaricaDocRiconoscimento).toHaveBeenCalledWith(file);
    fireEvent.change(screen.getByRole('textbox', { name: 'Codice OTP a 6 cifre' }), { target: { value: '12x3456' } });
    expect(p.setOtpCode).toHaveBeenCalledWith('123456');
  });

  it('in SES mantiene l’OTP nominato senza chiedere un documento FEA', () => {
    render(<FirmaOtpModal {...props()} livelloFirma="ses" />);
    expect(screen.getByRole('textbox', { name: 'Codice OTP a 6 cifre' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Documento di riconoscimento')).not.toBeInTheDocument();
  });
});

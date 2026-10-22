import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabChannels } from './TabChannels';

vi.mock('./PannelloRecordDns', () => ({ PannelloRecordDns: () => null }));
vi.mock('./PannelloWebhookTelegram', () => ({ PannelloWebhookTelegram: () => null }));

function props(): ComponentProps<typeof TabChannels> {
  return {
    handleSaveCompany: vi.fn(), handleTestSmtp: vi.fn(), testingSmtp: false, smtpTestResult: null,
    smtpHost: '', setSmtpHost: vi.fn(), smtpServername: '', setSmtpServername: vi.fn(),
    smtpPort: '587', setSmtpPort: vi.fn(), smtpUser: '', setSmtpUser: vi.fn(),
    smtpPass: '', setSmtpPass: vi.fn(), smtpFromEmail: '', setSmtpFromEmail: vi.fn(),
    smtpFromName: '', setSmtpFromName: vi.fn(), smtpReplyTo: '', setSmtpReplyTo: vi.fn(),
    smtpBcc: '', setSmtpBcc: vi.fn(), smtpSecure: true, setSmtpSecure: vi.fn(),
    handleTestImap: vi.fn(), testingImap: false, imapTestResult: null,
    imapProtocol: 'imap', setImapProtocol: vi.fn(), imapHost: '', setImapHost: vi.fn(),
    imapServername: '', setImapServername: vi.fn(), imapPort: '993', setImapPort: vi.fn(),
    imapFolder: 'INBOX', setImapFolder: vi.fn(), imapUser: '', setImapUser: vi.fn(),
    imapPass: '', setImapPass: vi.fn(), imapPollInterval: '5m', setImapPollInterval: vi.fn(),
    imapSecure: true, setImapSecure: vi.fn(), emailSignatureHtml: '', setEmailSignatureHtml: vi.fn(),
    handleTestChannel: vi.fn(), testingChannel: null, channelTestResult: {},
    waPhoneId: '', setWaPhoneId: vi.fn(), waVerifyToken: '', setWaVerifyToken: vi.fn(),
    waAccessToken: '', setWaAccessToken: vi.fn(), waAppId: '', setWaAppId: vi.fn(),
    waAppSecret: '', setWaAppSecret: vi.fn(), waOtpTemplate: '', setWaOtpTemplate: vi.fn(),
    waOtpTemplateLang: 'it', setWaOtpTemplateLang: vi.fn(), waCallbackUrl: null,
    onRigeneraSlug: vi.fn(), rigenerandoSlug: false,
    tgBotUsername: '', setTgBotUsername: vi.fn(), tgBotToken: '', setTgBotToken: vi.fn(),
    signalEndpoint: '', setSignalEndpoint: vi.fn(), signalToken: '', setSignalToken: vi.fn(),
    signalNumber: '', setSignalNumber: vi.fn(),
  };
}

describe('Canali — etichette collegate ai campi', () => {
  it('tutti i 33 campi, password comprese, hanno un nome accessibile e una label associata', () => {
    const { container } = render(<TabChannels {...props()} />);
    const campi = container.querySelectorAll('input, select, textarea');
    expect(campi).toHaveLength(33);
    for (const campo of campi) {
      expect(campo).toHaveAccessibleName();
      expect((campo as HTMLInputElement).labels?.length).toBe(1);
    }
  });

  it('i campi SMTP e OTP WhatsApp conservano le callback di modifica', () => {
    const p = props();
    render(<TabChannels {...p} />);
    fireEvent.change(screen.getByLabelText('Host Server SMTP *:'), { target: { value: 'smtp.test.example' } });
    expect(p.setSmtpHost).toHaveBeenCalledWith('smtp.test.example');
    fireEvent.change(screen.getByLabelText('Template OTP approvato (opzionale):'), { target: { value: 'otp_test' } });
    expect(p.setWaOtpTemplate).toHaveBeenCalledWith('otp_test');
    expect(screen.getByLabelText('Callback URL da incollare in Meta (sola lettura):')).toHaveAttribute('readonly');
  });
});

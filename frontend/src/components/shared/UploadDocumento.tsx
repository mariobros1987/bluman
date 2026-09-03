import React, { useRef, useState } from 'react';
import { Upload, X, File as FileIcon, CheckCircle2, AlertTriangle } from 'lucide-react';
import api from '@/lib/api';

interface UploadDocumentoProps {
  progettoId: string;
  microvoceProgettoId?: string;
  tipoDocumento?: string; // es. 'compilato', 'sorgente'
  onUploadSuccess?: () => void;
}

export const UploadDocumento: React.FC<UploadDocumentoProps> = ({
  progettoId,
  microvoceProgettoId,
  tipoDocumento = 'compilato',
  onUploadSuccess
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      if (selected.size > 20 * 1024 * 1024) {
        setError('Il file supera il limite di 20MB');
        setFile(null);
      } else {
        setFile(selected);
        setError(null);
        setSuccess(false);
      }
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setSuccess(false);

    const formData = new FormData();
    formData.append('progetto_id', progettoId);
    if (microvoceProgettoId) {
      formData.append('microvoce_progetto_id', microvoceProgettoId);
    }
    formData.append('tipo', tipoDocumento);
    formData.append('file', file);

    try {
      await api.post('/api/documenti/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setSuccess(true);
      setFile(null);
      if (onUploadSuccess) onUploadSuccess();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Errore durante l\'upload del file');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="w-full">
      <input 
        type="file" 
        className="hidden" 
        ref={fileInputRef} 
        onChange={handleFileChange}
      />
      
      {!file && !success && (
        <div 
          className="border-2 border-dashed border-color hover:border-primary p-6 rounded-xl text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-2 group"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="w-10 h-10 rounded-full bg-bg-sidebar group-hover:bg-primary-light flex items-center justify-center text-muted group-hover:text-primary transition-colors">
            <Upload size={20} />
          </div>
          <div>
            <p className="text-sm font-semibold">Clicca per caricare un documento</p>
            <p className="text-xs text-muted">Limite: 20MB. Formati consentiti: PDF, PNG, JPG, ZIP/Office.</p>
          </div>
        </div>
      )}

      {file && (
        <div className="border border-color p-3 rounded-lg bg-bg-sidebar flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-bg-card rounded text-primary">
              <FileIcon size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold truncate max-w-[200px] sm:max-w-xs">{file.name}</p>
              <p className="text-xs text-muted">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              className="text-xs text-muted hover:text-error p-1"
              onClick={() => setFile(null)}
              disabled={uploading}
            >
              <X size={16} />
            </button>
            <button
              className="btn-primary text-xs py-1.5"
              onClick={handleUpload}
              disabled={uploading}
            >
              {uploading ? 'Caricamento...' : 'Conferma Upload'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 text-xs text-error flex items-center gap-1 bg-error-light p-2 rounded">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {success && !file && (
        <div className="mt-2 text-xs text-success flex items-center gap-1 bg-success-light p-2 rounded border border-success/30">
          <CheckCircle2 size={14} /> Documento caricato con successo (In attesa di scansione antivirus)
        </div>
      )}
    </div>
  );
};

import React, { useState } from "react";
import { cambiaPasswordStaffApi } from "../api/client";

interface MustChangePasswordModalProps {
  user: {
    id?: string;
    nome?: string;
    email?: string;
    ruolo?: string;
  } | null;
  onSuccess: () => void;
}

export function MustChangePasswordModal({ user, onSuccess }: MustChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getPasswordStrength = (pwd: string) => {
    if (!pwd) return { score: 0, text: "Nessuna password", color: "var(--muted)" };
    let score = 0;
    if (pwd.length >= 8) score += 1;
    if (pwd.length >= 12) score += 1;
    if (/[A-Z]/.test(pwd)) score += 1;
    if (/[0-9]/.test(pwd)) score += 1;
    if (/[^A-Za-z0-9]/.test(pwd)) score += 1;

    if (score <= 2) return { score: 1, text: "Debole (richiesti 8+ caratteri, maiuscole e numeri)", color: "var(--red)" };
    if (score <= 3) return { score: 2, text: "Media", color: "var(--amber)" };
    if (score <= 4) return { score: 3, text: "Robusta (ISO/IEC 27001)", color: "var(--green)" };
    return { score: 4, text: "Eccellente (Crittograficamente Sicura)", color: "var(--green)" };
  };

  const strength = getPasswordStrength(newPassword);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentPassword) {
      setError("Inserisci la password temporanea che hai ricevuto.");
      return;
    }
    if (newPassword.length < 8) {
      setError("La nuova password deve contenere almeno 8 caratteri.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("La nuova password e la conferma non coincidono.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("La nuova password non può essere uguale alla password temporanea.");
      return;
    }

    setLoading(true);
    try {
      await cambiaPasswordStaffApi(currentPassword, newPassword);

      const userRaw = localStorage.getItem("bluman_user");
      if (userRaw) {
        try {
          const u = JSON.parse(userRaw);
          u.mustChangePassword = false;
          u.stato = "attivo";
          localStorage.setItem("bluman_user", JSON.stringify(u));
        } catch {}
      }

      onSuccess();
    } catch (err: any) {
      setError(err.message || "Errore durante l'aggiornamento della password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.92)",
        backdropFilter: "blur(10px)",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          backgroundColor: "var(--sidebar, var(--surface-2))",
          border: "1px solid var(--indigo-d)",
          borderRadius: 20,
          width: "100%",
          maxWidth: 520,
          boxShadow: "0 25px 60px -15px rgba(0, 0, 0, 0.9), 0 0 30px rgba(99, 102, 241, 0.25)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "24px 28px",
            background: "linear-gradient(135deg, rgba(30, 27, 75, 0.8) 0%, rgba(17, 24, 39, 0.9) 100%)",
            borderBottom: "1px solid var(--border, var(--surface-1))",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: "linear-gradient(135deg, var(--indigo-d) 0%, var(--indigo-d) 100%)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              boxShadow: "0 8px 16px rgba(79, 70, 229, 0.4)",
              flexShrink: 0,
            }}
          >
            🔐
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--pill-sky-fg)", letterSpacing: "-0.02em" }}>
              Primo Accesso: Imposta Nuova Password
            </div>
            <div style={{ fontSize: 12, color: "var(--muted, var(--muted))", marginTop: 3 }}>
              Benvenuto in BluMan Advisory Platform, <strong>{user?.nome || user?.email || "Collaboratore"}</strong>
            </div>
          </div>
        </div>

        <div style={{ padding: "24px 28px" }}>
          <div
            style={{
              background: "var(--pill-indigo-bg)",
              border: "1px solid var(--indigo-d)",
              borderRadius: 12,
              padding: "12px 16px",
              fontSize: 12,
              color: "var(--pill-indigo-fg)",
              lineHeight: 1.5,
              marginBottom: 20,
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <span style={{ fontSize: 16 }}>🛡️</span>
            <div>
              Stai effettuando il primo accesso con una password temporanea.
              Per la conformità <strong>ISO/IEC 27001</strong> e la riservatezza dei dossier di studio, imposta subito la tua password personale permanente prima di accedere alla piattaforma.
            </div>
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {error && (
              <div
                style={{
                  background: "var(--pill-red-bg)",
                  border: "1px solid var(--red)",
                  color: "var(--pill-red-fg)",
                  padding: "10px 14px",
                  borderRadius: 10,
                  fontSize: 12,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>⚠️</span> {error}
              </div>
            )}

            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted, var(--muted))", display: "block", marginBottom: 6 }}>
                Password Temporanea Ricevuta *
              </label>
              <input
                type={showPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Inserisci la password provvisoria"
                required
                style={{
                  width: "100%",
                  background: "var(--bg, var(--surface-2))",
                  border: "1px solid var(--border, var(--border))",
                  borderRadius: 10,
                  padding: "11px 14px",
                  color: "#fff",
                  fontSize: 13,
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted, var(--muted))" }}>
                  Nuova Password Personale * (min. 8 caratteri)
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--indigo-l, var(--indigo-l))",
                    fontSize: 11,
                    cursor: "pointer",
                    padding: 0,
                    fontWeight: 600,
                  }}
                >
                  {showPassword ? "🙈 Nascondi" : "👁 Mostra"}
                </button>
              </div>
              <input
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Scegli una nuova password robusta"
                required
                style={{
                  width: "100%",
                  background: "var(--bg, var(--surface-2))",
                  border: "1px solid var(--border, var(--border))",
                  borderRadius: 10,
                  padding: "11px 14px",
                  color: "#fff",
                  fontSize: 13,
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />

              {newPassword && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", gap: 4, height: 4, borderRadius: 2, overflow: "hidden", background: "var(--surface-1)" }}>
                    <div style={{ flex: 1, background: strength.score >= 1 ? strength.color : "transparent" }} />
                    <div style={{ flex: 1, background: strength.score >= 2 ? strength.color : "transparent" }} />
                    <div style={{ flex: 1, background: strength.score >= 3 ? strength.color : "transparent" }} />
                    <div style={{ flex: 1, background: strength.score >= 4 ? strength.color : "transparent" }} />
                  </div>
                  <div style={{ fontSize: 10.5, color: strength.color, marginTop: 4, fontWeight: 600 }}>
                    Robustezza: {strength.text}
                  </div>
                </div>
              )}
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted, var(--muted))", display: "block", marginBottom: 6 }}>
                Conferma Nuova Password *
              </label>
              <input
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Ripeti la nuova password"
                required
                style={{
                  width: "100%",
                  background: "var(--bg, var(--surface-2))",
                  border: "1px solid var(--border, var(--border))",
                  borderRadius: 10,
                  padding: "11px 14px",
                  color: "#fff",
                  fontSize: 13,
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
              {confirmPassword && newPassword !== confirmPassword && (
                <span style={{ fontSize: 11, color: "var(--pill-red-fg)", marginTop: 4, display: "block" }}>
                  ⚠ Le due password non coincidono.
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !currentPassword || newPassword.length < 8 || newPassword !== confirmPassword}
              style={{
                background: "linear-gradient(135deg, var(--indigo-d) 0%, var(--indigo-d) 100%)",
                color: "#fff",
                border: "none",
                padding: "13px 20px",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 15px rgba(79, 70, 229, 0.4)",
                opacity: (!currentPassword || newPassword.length < 8 || newPassword !== confirmPassword || loading) ? 0.5 : 1,
                marginTop: 8,
                transition: "all .2s ease",
              }}
            >
              {loading ? "Salvataggio in corso..." : "🔒 Conferma & Accedi alla Piattaforma"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

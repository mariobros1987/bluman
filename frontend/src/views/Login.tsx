import React, { useState } from 'react';
import { useSearchParams, Navigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import './Login.css';

export const Login: React.FC = () => {
  const { session } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchParams] = useSearchParams();
  
  // Se c'è già una sessione valida, redirige
  if (session) {
    const redirect = searchParams.get('redirect') || '/app/dashboard';
    return <Navigate to={redirect} replace />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
      setError('Credenziali non valide.');
      setLoading(false);
    } else {
      // Il listener onAuthStateChange in AuthStore gestirà il re-render
      // e verremo rediretti dallo statement iniziale `if (user)`
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-brand text-center mb-6">
          <h1 className="text-3xl font-semibold">BluMan<span className="text-primary">.</span></h1>
          <p className="text-muted mt-2">Accedi al tuo account</p>
        </div>
        
        <Card>
          <form onSubmit={handleLogin} className="flex-col gap-4">
            {error && (
              <div className="login-error text-sm text-error bg-error-light p-3 rounded-md mb-4">
                {error}
              </div>
            )}
            
            <div className="form-group">
              <label>Email</label>
              <input 
                type="email" 
                className="form-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            
            <div className="form-group">
              <label>Password</label>
              <input 
                type="password" 
                className="form-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            
            <Button type="submit" variant="primary" className="w-full mt-2" isLoading={loading}>
              Accedi
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
};

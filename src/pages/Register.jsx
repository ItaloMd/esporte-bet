import React, { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { UserPlus, Mail, Lock, Loader2, ShieldCheck } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";
import { toast } from "@/components/ui/use-toast";
import { safeReturnTo } from "@/lib/authReturnTo";
import { formatCpf, onlyDigits, validateCpf } from "@/lib/cpf";
import { storedReferralCode } from "@/lib/referral";

function ageFrom(value) {
  if (!value) return null;
  const birth = new Date(value);
  if (Number.isNaN(birth.getTime())) return null;
  return Math.floor((Date.now() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

export default function Register() {
  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const returnTo = safeReturnTo();

  const createProfile = async () => {
    try {
      const response = await base44.functions.invoke("createUserProfile", {
        full_name: fullName.trim(),
        cpf: onlyDigits(cpf),
        birth_date: birthDate,
        ref_code: storedReferralCode(),
      });
      if (response.data?.error) {
        setProfileError(response.data.error);
        return false;
      }
      return true;
    } catch (err) {
      setProfileError(err?.response?.data?.error || "Não foi possível concluir seus dados de cadastro.");
      return false;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (fullName.trim().length < 5 || !fullName.trim().includes(" ")) {
      setError("Informe seu nome completo (nome e sobrenome).");
      return;
    }
    if (!validateCpf(cpf)) {
      setError("CPF inválido: confira os números informados.");
      return;
    }
    const age = ageFrom(birthDate);
    if (age === null) {
      setError("Informe sua data de nascimento.");
      return;
    }
    if (age < 18) {
      setError("O uso da plataforma é restrito a pessoas com 18 anos ou mais.");
      return;
    }
    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    if (!accepted) {
      setError("É necessário aceitar os termos de uso e a política de privacidade.");
      return;
    }
    setLoading(true);
    try {
      await base44.auth.register({ email, password });
      setShowOtp(true);
    } catch (err) {
      setError(err.message || "Não foi possível criar a conta.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await base44.auth.verifyOtp({ email, otpCode });
      if (result?.access_token) {
        base44.auth.setToken(result.access_token);
      }
      const ok = await createProfile();
      if (!ok) {
        setLoading(false);
        return;
      }
      window.location.href = returnTo;
    } catch (err) {
      setError(err.message || "Código de verificação inválido.");
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError("");
    try {
      await base44.auth.resendOtp(email);
      toast({ title: "Código enviado", description: "Confira seu e-mail para o novo código." });
    } catch (err) {
      setError(err.message || "Não foi possível reenviar o código.");
    }
  };

  const handleGoogle = () => {
    base44.auth.loginWithProvider("google", "/perfil");
  };

  if (showOtp) {
    return (
      <AuthLayout icon={Mail} title="Confirme seu e-mail" subtitle={`Enviamos um código para ${email}`}>
        {error && <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        {profileError && (
          <div className="mb-4 space-y-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <p>{profileError}</p>
            <Button variant="outline" size="sm" asChild>
              <Link to="/perfil">Concluir meus dados no perfil</Link>
            </Button>
          </div>
        )}
        <div className="mb-6 flex justify-center">
          <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode} autoFocus autoComplete="one-time-code">
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </div>
        <Button className="h-12 w-full font-medium" onClick={handleVerify} disabled={loading || otpCode.length < 6}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Verificando...
            </>
          ) : (
            "Verificar e concluir cadastro"
          )}
        </Button>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Não recebeu o código?{" "}
          <button onClick={handleResend} className="font-medium text-primary hover:underline">
            Reenviar
          </button>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={UserPlus}
      title="Criar sua conta"
      subtitle="Uma conta por CPF, com 18 anos ou mais"
      footer={
        <>
          Já tem conta?{" "}
          <Link
            to={"/login" + (returnTo !== "/" ? "?returnTo=" + encodeURIComponent(returnTo) : "")}
            className="font-medium text-primary hover:underline"
          >
            Entrar
          </Link>
        </>
      }
    >
      <Button
        type="button"
        variant="outline"
        className="mb-6 h-12 w-full border-border/70 bg-secondary/40 text-sm font-medium hover:bg-secondary"
        onClick={handleGoogle}
      >
        <GoogleIcon className="mr-2 h-5 w-5" />
        Continuar com Google
      </Button>

      <div className="mb-6 flex items-center gap-3 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        ou
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      {error && <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="full_name">Nome completo</Label>
          <Input
            id="full_name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Nome e sobrenome"
            autoComplete="name"
            className="h-12"
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="cpf">CPF</Label>
            <Input
              id="cpf"
              value={cpf}
              onChange={(e) => setCpf(formatCpf(e.target.value))}
              placeholder="000.000.000-00"
              inputMode="numeric"
              className="h-12"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="birth_date">Data de nascimento</Label>
            <Input
              id="birth_date"
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="h-12"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="voce@exemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 pl-10"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 pl-10"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm">Confirmar senha</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-12 pl-10"
              required
            />
          </div>
        </div>

        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <Checkbox checked={accepted} onCheckedChange={setAccepted} className="mt-0.5" />
          <span>
            Declaro ter 18 anos ou mais e aceito os{" "}
            <Link to="/termos" className="text-primary hover:underline">termos de uso</Link> e a{" "}
            <Link to="/privacidade" className="text-primary hover:underline">política de privacidade</Link>.
          </span>
        </label>

        <p className="flex items-start gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[11px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          O CPF identifica uma única conta por pessoa, nunca é usado como senha e só aparece de forma mascarada no
          sistema. A confirmação do CPF não substitui a verificação de identidade, feita por fluxo próprio.
        </p>

        <Button type="submit" className="h-12 w-full font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Criando conta...
            </>
          ) : (
            "Criar conta"
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
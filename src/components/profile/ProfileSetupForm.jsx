import React, { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "react-router-dom";
import { formatCpf, onlyDigits, validateCpf } from "@/lib/cpf";
import { storedReferralCode } from "@/lib/referral";

export default function ProfileSetupForm({ onDone, defaultName = "", defaultEmail = "" }) {
  const [form, setForm] = useState({ full_name: defaultName, cpf: "", birth_date: "", display_name: "", state: "", city: "" });
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const update = (patch) => setForm((current) => ({ ...current, ...patch }));

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (!validateCpf(form.cpf)) {
      setError("CPF inválido: confira os números informados.");
      return;
    }
    if (!accepted) {
      setError("É necessário aceitar os termos de uso e a política de privacidade.");
      return;
    }
    setLoading(true);
    try {
      const response = await base44.functions.invoke("createUserProfile", {
        ...form,
        cpf: onlyDigits(form.cpf),
        ref_code: storedReferralCode(),
      });
      if (response.data?.error) {
        setError(response.data.error);
        return;
      }
      onDone?.(response.data);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || "Não foi possível concluir o cadastro.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="card-surface space-y-4 p-4">
      <div>
        <h2 className="text-base font-semibold">Complete seu cadastro</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          O CPF identifica uma única conta por pessoa. Ele nunca aparece completo em telas públicas e não pode ser
          alterado depois do cadastro sem uma solicitação de correção.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="full_name">Nome completo</Label>
          <Input
            id="full_name"
            value={form.full_name}
            onChange={(event) => update({ full_name: event.target.value })}
            placeholder="Nome e sobrenome"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cpf">CPF</Label>
          <Input
            id="cpf"
            value={form.cpf}
            onChange={(event) => update({ cpf: formatCpf(event.target.value) })}
            placeholder="000.000.000-00"
            inputMode="numeric"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="birth_date">Data de nascimento</Label>
          <Input
            id="birth_date"
            type="date"
            value={form.birth_date}
            onChange={(event) => update({ birth_date: event.target.value })}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="display_name">Nome de exibição</Label>
          <Input
            id="display_name"
            value={form.display_name}
            onChange={(event) => update({ display_name: event.target.value })}
            placeholder="Como você quer aparecer"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="state">Estado (UF)</Label>
          <Input id="state" value={form.state} onChange={(event) => update({ state: event.target.value })} placeholder="SP" />
        </div>
      </div>

      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <Checkbox checked={accepted} onCheckedChange={setAccepted} className="mt-0.5" />
        <span>
          Declaro ter 18 anos ou mais e aceito os{" "}
          <Link to="/termos" className="text-primary hover:underline">termos de uso</Link> e a{" "}
          <Link to="/privacidade" className="text-primary hover:underline">política de privacidade</Link>. Entendo que
          a plataforma é de simulação, sem apostas com dinheiro real.
        </span>
      </label>

      {error && <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
          Salvar cadastro
        </Button>
        {defaultEmail && <span className="text-xs text-muted-foreground">Conta: {defaultEmail}</span>}
      </div>
    </form>
  );
}
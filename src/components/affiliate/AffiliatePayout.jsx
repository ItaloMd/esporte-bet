import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/format";

const KEY_TYPES = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone" },
  { value: "random", label: "Chave aleatória" },
];

/** Solicitação de saque das comissões liberadas do afiliado. */
export default function AffiliatePayout({ available, minWithdrawal, enabled, onRequested }) {
  const [amount, setAmount] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [pixKeyType, setPixKeyType] = useState("cpf");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      await base44.functions.invoke("requestWithdrawal", {
        kind: "affiliate",
        amount: Number(amount),
        pix_key: pixKey,
        pix_key_type: pixKeyType,
      });
      setDone(true);
      setAmount("");
      onRequested?.();
    } catch (err) {
      setError(err?.response?.data?.error || err.message || "Não foi possível solicitar o saque.");
    } finally {
      setLoading(false);
    }
  };

  if (!enabled) {
    return (
      <p className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
        O saque de comissões ainda não foi liberado pela administração.
      </p>
    );
  }

  if (done) {
    return (
      <div className="space-y-3 text-center">
        <p className="font-semibold">Saque de comissões solicitado</p>
        <p className="text-sm text-muted-foreground">
          O valor será enviado para a sua chave PIX após a liberação da administração.
        </p>
        <Button variant="outline" onClick={() => setDone(false)}>Solicitar outro saque</Button>
      </div>
    );
  }

  const blocked = available < minWithdrawal;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="affiliate-amount">Valor do saque</Label>
        <Input
          id="affiliate-amount"
          type="number"
          min={minWithdrawal}
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          disabled={blocked}
        />
        <p className="text-[11px] text-muted-foreground">
          Disponível {formatCurrency(available)} · saque mínimo de {formatCurrency(minWithdrawal)}.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="affiliate-key-type">Tipo de chave PIX</Label>
        <select
          id="affiliate-key-type"
          value={pixKeyType}
          onChange={(event) => setPixKeyType(event.target.value)}
          disabled={blocked}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        >
          {KEY_TYPES.map((type) => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="affiliate-key">Chave PIX de destino</Label>
        <Input
          id="affiliate-key"
          value={pixKey}
          onChange={(event) => setPixKey(event.target.value)}
          placeholder="Chave de sua titularidade"
          disabled={blocked}
        />
      </div>

      {blocked && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
          Você ainda não tem comissões liberadas suficientes para o saque mínimo.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      <Button className="w-full" onClick={submit} disabled={loading || blocked}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Solicitar saque de comissões
      </Button>
    </div>
  );
}
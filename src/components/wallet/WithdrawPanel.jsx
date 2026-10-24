import React, { useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/format";
import KycForm from "@/components/wallet/KycForm";

const KEY_TYPES = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone" },
  { value: "random", label: "Chave aleatória" },
];

export default function WithdrawPanel({
  minWithdrawal,
  enabled,
  rolloverPending,
  kycApproved,
  kycLatest,
  userId,
  userEmail,
  profile,
  onRequested,
  onKycSubmitted,
}) {
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
      <div className="space-y-3">
        <p className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          Os saques estão temporariamente desativados pela plataforma.
        </p>
        <Button className="w-full" disabled>
          Saques desativados
        </Button>
      </div>
    );
  }

  if (!kycApproved) {
    if (kycLatest?.status === "pending") {
      return (
        <div className="space-y-3 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-500/15">
            <Clock className="h-6 w-6 text-amber-400" aria-hidden="true" />
          </span>
          <p className="font-semibold">Verificação em análise</p>
          <p className="text-sm text-muted-foreground">
            Recebemos as suas imagens. Assim que a análise for concluída, o saque é liberado automaticamente e você não
            precisa reenviar nada.
          </p>
        </div>
      );
    }
    return (
      <KycForm
        userId={userId}
        userEmail={userEmail}
        profile={profile}
        rejectedNote={
          kycLatest?.status === "rejected"
            ? kycLatest.reviewer_note || "A verificação anterior não foi aprovada. Reenvie as imagens com boa iluminação."
            : ""
        }
        onSubmitted={onKycSubmitted}
      />
    );
  }

  if (done) {
    return (
      <div className="space-y-3 text-center">
        <p className="font-semibold">Saque solicitado</p>
        <p className="text-sm text-muted-foreground">
          O valor ficou reservado e será enviado para a sua chave PIX após a liberação. Você acompanha o status abaixo.
        </p>
        <Button variant="outline" onClick={() => setDone(false)}>Solicitar outro saque</Button>
      </div>
    );
  }

  const blocked = rolloverPending > 0;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="withdraw-amount">Valor do saque</Label>
        <Input
          id="withdraw-amount"
          type="number"
          min={minWithdrawal}
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          disabled={blocked}
        />
        <p className="text-[11px] text-muted-foreground">Saque mínimo de {formatCurrency(minWithdrawal)}.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="withdraw-key-type">Tipo de chave PIX</Label>
        <select
          id="withdraw-key-type"
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
        <Label htmlFor="withdraw-key">Chave PIX de destino</Label>
        <Input
          id="withdraw-key"
          value={pixKey}
          onChange={(event) => setPixKey(event.target.value)}
          placeholder="Somente sua chave, de sua titularidade"
          disabled={blocked}
        />
      </div>

      {blocked && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
          Rollover pendente: aposte mais {formatCurrency(rolloverPending)} para liberar o saque.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      <Button className="w-full" onClick={submit} disabled={loading || blocked}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Solicitar saque
      </Button>
    </div>
  );
}
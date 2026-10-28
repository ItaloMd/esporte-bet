import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/format";
import { getStoredUtm } from "@/lib/utmCapture";

export default function DepositPanel({ minDeposit, enabled, profile, onCredited }) {
  const [amount, setAmount] = useState(String(minDeposit || 10));
  const [deposit, setDeposit] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const cpfMissing = !String(profile?.cpf || "").replace(/\D/g, "").length;

  const create = async () => {
    setError("");
    setLoading(true);
    try {
      const response = await base44.functions.invoke("liqfyDeposit", {
        action: "create",
        amount: Number(amount),
        tracking: getStoredUtm(),
      });
      setDeposit(response.data?.deposit || null);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || "Não foi possível gerar o PIX.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!deposit || deposit.status !== "pending") return undefined;
    const timer = setInterval(async () => {
      try {
        const response = await base44.functions.invoke("liqfyDeposit", {
          action: "sync",
          external_id: deposit.external_id,
        });
        if (response.data?.status === "paid") {
          setDeposit(response.data.deposit);
          onCredited?.();
        }
      } catch {
        // O webhook é a fonte principal; a verificação é apenas um reforço.
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [deposit, onCredited]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(deposit.pix_copia_cola);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (deposit?.status === "paid") {
    return (
      <div className="space-y-3 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/15">
          <Check className="h-6 w-6 text-primary" aria-hidden="true" />
        </span>
        <p className="font-semibold">Depósito confirmado</p>
        <p className="text-sm text-muted-foreground">
          {formatCurrency(deposit.amount)} creditados no seu saldo.
        </p>
        <Button variant="outline" onClick={() => setDeposit(null)}>Fazer outro depósito</Button>
      </div>
    );
  }

  if (deposit) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Abra o app do seu banco e pague o QR Code de {formatCurrency(deposit.amount)}. A confirmação é automática.
        </p>
        {deposit.qr_code_base64 && (
          <div className="mx-auto w-48 rounded-xl bg-white p-2">
            <img src={deposit.qr_code_base64} alt="QR Code PIX para depósito" className="h-full w-full" />
          </div>
        )}
        <div className="space-y-2">
          <Label>PIX copia e cola</Label>
          <div className="flex gap-2">
            <Input readOnly value={deposit.pix_copia_cola} className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={copy} aria-label="Copiar código PIX">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Aguardando o pagamento…
        </div>
        <Button variant="ghost" size="sm" onClick={() => setDeposit(null)}>Cancelar</Button>
      </div>
    );
  }

  if (cpfMissing) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Para gerar o PIX do depósito precisamos do seu CPF cadastrado no perfil.
        </p>
        <Button asChild className="w-full">
          <Link to="/perfil">Completar meu perfil</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="deposit-amount">Valor do depósito</Label>
        <Input
          id="deposit-amount"
          type="number"
          min={minDeposit}
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          disabled={!enabled}
        />
        <p className="text-[11px] text-muted-foreground">Depósito mínimo de {formatCurrency(minDeposit)}.</p>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button className="w-full" onClick={create} disabled={loading || !enabled}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {enabled ? "Gerar PIX de depósito" : "Depósitos desativados"}
      </Button>
    </div>
  );
}
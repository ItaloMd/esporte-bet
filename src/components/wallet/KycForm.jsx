import React, { useState } from "react";
import { AlertTriangle, Camera, CreditCard, Loader2, ShieldCheck, Upload } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const STEPS = [
  {
    key: "selfie",
    uri: "selfie_uri",
    label: "Foto do seu rosto",
    hint: "Selfie nítida, sem óculos escuros, boné ou filtro.",
    icon: Camera,
  },
  {
    key: "document",
    uri: "document_uri",
    label: "Foto da identidade",
    hint: "RG ou CNH com os dados legíveis.",
    icon: CreditCard,
  },
  {
    key: "document_selfie",
    uri: "document_selfie_uri",
    label: "Você segurando a identidade",
    hint: "Seu rosto e o documento visíveis na mesma foto.",
    icon: ShieldCheck,
  },
];

/**
 * Verificação de identidade exigida no primeiro saque: rosto, documento e uma
 * foto segurando o documento. As imagens são armazenadas de forma privada.
 */
export default function KycForm({ userId, userEmail, profile, rejectedNote, onSubmitted }) {
  const [files, setFiles] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    const missing = STEPS.find((step) => !files[step.key]);
    if (missing) {
      setError(`Envie a imagem: ${missing.label.toLowerCase()}.`);
      return;
    }
    setLoading(true);
    try {
      const uploaded = {};
      for (const step of STEPS) {
        const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file: files[step.key] });
        uploaded[step.uri] = file_uri;
      }
      await base44.entities.KycSubmission.create({
        user_id: userId,
        user_email: userEmail,
        full_name: profile?.full_name,
        cpf_masked: profile?.cpf_masked,
        ...uploaded,
        status: "pending",
        submitted_at: new Date().toISOString(),
      });
      onSubmitted?.();
    } catch (err) {
      setError(err?.response?.data?.error || err.message || "Não foi possível enviar as imagens.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[11px] text-foreground/90">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <p>
          Antes do primeiro saque precisamos confirmar sua identidade. Envie as três imagens abaixo; a análise é feita
          pela nossa equipe e, depois de aprovada, você saca sem repetir este passo.
        </p>
      </div>

      {rejectedNote && (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {rejectedNote}
        </p>
      )}

      {STEPS.map((step) => (
        <div key={step.key} className="space-y-1.5">
          <Label htmlFor={`kyc-${step.key}`} className="flex items-center gap-1.5">
            <step.icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            {step.label}
          </Label>
          <input
            id={`kyc-${step.key}`}
            type="file"
            accept="image/*"
            disabled={loading}
            onChange={(event) => setFiles((current) => ({ ...current, [step.key]: event.target.files?.[0] || null }))}
            className="block w-full cursor-pointer rounded-lg border border-input bg-transparent px-3 py-2 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground"
          />
          <p className="text-[11px] text-muted-foreground">{step.hint}</p>
        </div>
      ))}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Button className="w-full" onClick={submit} disabled={loading}>
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
        {loading ? "Enviando imagens…" : "Enviar para verificação"}
      </Button>
    </div>
  );
}
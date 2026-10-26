import React, { useEffect, useState } from "react";
import { Check, Eye, Loader2, Search, ShieldX } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatCpf, validateCpf } from "@/lib/cpf";
import { Button } from "@/components/ui/button";
import { Image } from "@/components/ui/image";
import { formatDateTime } from "@/lib/format";
import { toast } from "@/components/ui/use-toast";
import { logAdminAction } from "@/lib/adminAudit";

const STATUS_STYLE = {
  pending: "border-amber-500/40 text-amber-400",
  approved: "border-primary/40 text-primary",
  rejected: "border-destructive/40 text-destructive",
};

const STATUS_LABEL = { pending: "Em análise", approved: "Aprovada", rejected: "Recusada" };

const PHOTOS = [
  { key: "selfie_uri", label: "Rosto" },
  { key: "document_uri", label: "Identidade" },
  { key: "document_selfie_uri", label: "Segurando a identidade" },
];

/** Revisão das verificações de identidade enviadas pelos jogadores. */
export default function AdminKyc({ actor }) {
  const [rows, setRows] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [urls, setUrls] = useState({});
  const [busy, setBusy] = useState(null);

  const load = async () => {
    setLoading(true);
    const [submissions, profilePage] = await Promise.all([
      base44.entities.KycSubmission.filter({}, { sort: "-created_date", limit: 50 }),
      base44.entities.UserProfile.filter({}, { limit: 200 }),
    ]);
    setProfiles(Object.fromEntries((profilePage.items || []).map((profile) => [profile.user_id, profile])));
    setRows(submissions.items || []);
    setLoading(false);
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, []);

  const open = async (row) => {
    if (openId === row.id) {
      setOpenId(null);
      return;
    }
    setOpenId(row.id);
    if (urls[row.id]) return;
    try {
      const entries = await Promise.all(
        PHOTOS.map(async (photo) => {
          const { signed_url } = await base44.integrations.Core.CreateFileSignedUrl({ file_uri: row[photo.key] });
          return [photo.key, signed_url];
        }),
      );
      setUrls((current) => ({ ...current, [row.id]: Object.fromEntries(entries) }));
    } catch {
      toast({ title: "Não foi possível abrir as imagens", variant: "destructive" });
    }
  };

  const review = async (row, status) => {
    setBusy(row.id);
    try {
      await base44.entities.KycSubmission.update(row.id, {
        status,
        reviewed_at: new Date().toISOString(),
        reviewer_note:
          status === "rejected" ? "Imagens não permitiram confirmar a identidade. Reenvie com melhor iluminação." : "",
      });
      if (status === "approved") {
        const profilePage = await base44.entities.UserProfile.filter({ user_id: row.user_id }, { limit: 1 });
        const profile = profilePage.items?.[0];
        if (profile) await base44.entities.UserProfile.update(profile.id, { identity_status: "verified" });
      }
      await logAdminAction({
        actor,
        action: `kyc.${status}`,
        targetType: "KycSubmission",
        targetId: row.id,
        details: `Verificação de identidade ${STATUS_LABEL[status].toLowerCase()} para ${row.user_email || row.user_id}.`,
        severity: status === "rejected" ? "warning" : "info",
      });
      toast({ title: status === "approved" ? "Identidade aprovada" : "Verificação recusada" });
      load();
    } catch (error) {
      toast({ title: "Não foi possível atualizar", description: error.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="card-surface h-24 animate-pulse" />;

  const term = search.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (!term) return true;
    const cpf = String(profiles[row.user_id]?.cpf || "").replace(/\D/g, "");
    return (
      `${row.full_name || ""} ${row.user_email || ""}`.toLowerCase().includes(term) ||
      (cpf && (cpf.includes(term.replace(/\D/g, "")) || formatCpf(cpf).includes(term)))
    );
  });

  return (
    <section className="card-surface space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Verificações de identidade</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Enviadas no primeiro saque: foto do rosto, foto da identidade e foto segurando a identidade. O CPF completo é
          exibido com a validação matemática do documento.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nome, e-mail ou CPF"
          className="h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-3 text-sm"
        />
      </div>

      {filtered.length ? (
        filtered.map((row) => {
          const cpf = String(profiles[row.user_id]?.cpf || "").replace(/\D/g, "");
          const cpfValid = cpf ? validateCpf(cpf) : null;
          return (
          <div key={row.id} className="space-y-2 rounded-lg border border-border px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{row.full_name || row.user_email || "Jogador"}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {row.user_email || "—"} · enviado em {formatDateTime(row.submitted_at || row.created_date)}
                </p>
                <p className="text-[11px]">
                  CPF: <span className="font-medium">{cpf ? formatCpf(cpf) : row.cpf_masked || "não vinculado"}</span>
                  {cpfValid !== null && (
                    <span
                      className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] ${
                        cpfValid ? "border-emerald-500/40 text-emerald-400" : "border-destructive/40 text-destructive"
                      }`}
                    >
                      {cpfValid ? "válido" : "inválido"}
                    </span>
                  )}
                </p>
              </div>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_STYLE[row.status] || ""}`}>
                {STATUS_LABEL[row.status] || row.status}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => open(row)}>
                <Eye className="mr-1.5 h-3.5 w-3.5" /> {openId === row.id ? "Ocultar fotos" : "Ver fotos"}
              </Button>
              {row.status !== "approved" && (
                <Button size="sm" disabled={busy === row.id} onClick={() => review(row, "approved")}>
                  {busy === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Check className="mr-1.5 h-3.5 w-3.5" /> Aprovar</>}
                </Button>
              )}
              {row.status !== "rejected" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  disabled={busy === row.id}
                  onClick={() => review(row, "rejected")}
                >
                  <ShieldX className="mr-1.5 h-3.5 w-3.5" /> Recusar
                </Button>
              )}
            </div>

            {openId === row.id && (
              <div className="grid gap-2 sm:grid-cols-3">
                {PHOTOS.map((photo) => (
                  <figure key={photo.key} className="space-y-1">
                    <div className="aspect-square overflow-hidden rounded-lg border border-border bg-secondary/40">
                      {urls[row.id]?.[photo.key] ? (
                        <Image src={urls[row.id][photo.key]} alt={photo.label} className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full w-full place-items-center">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <figcaption className="text-[11px] text-muted-foreground">{photo.label}</figcaption>
                  </figure>
                ))}
              </div>
            )}

            {row.reviewer_note && <p className="text-[11px] text-muted-foreground">{row.reviewer_note}</p>}
          </div>
          );
        })
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma verificação encontrada.</p>
      )}
    </section>
  );
}
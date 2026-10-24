import React, { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Image } from "@/components/ui/image";
import { toast } from "@/components/ui/use-toast";
import { logAdminAction } from "@/lib/adminAudit";

const EMPTY_FORM = { title: "", image_url: "", link_url: "", sort_order: 0, active: true };

export default function AdminBanners({ actor }) {
  const [banners, setBanners] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const load = async () => {
    setLoading(true);
    const page = await base44.entities.Banner.list({ sort: "sort_order", limit: 50 });
    setBanners(page.items || []);
    setLoading(false);
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, []);

  const update = (patch) => setForm((current) => ({ ...current, ...patch }));

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadPublicFile({ file });
      update({ image_url: file_url });
    } catch (error) {
      toast({ title: "Falha no envio da imagem", description: error.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const create = async () => {
    if (!form.image_url) {
      toast({ title: "Envie a imagem do banner antes de salvar", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await base44.entities.Banner.create({ ...form, sort_order: Number(form.sort_order) || 0 });
      await logAdminAction({
        actor,
        action: "banner.created",
        targetType: "Banner",
        details: `${form.title || "sem título"} → ${form.link_url || "sem link"}`,
      });
      setForm(EMPTY_FORM);
      await load();
      toast({ title: "Banner adicionado" });
    } catch (error) {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const patch = async (banner, changes) => {
    try {
      await base44.entities.Banner.update(banner.id, changes);
      await load();
    } catch (error) {
      toast({ title: "Não foi possível atualizar", description: error.message, variant: "destructive" });
    }
  };

  const remove = async (banner) => {
    try {
      await base44.entities.Banner.delete(banner.id);
      await logAdminAction({
        actor,
        action: "banner.deleted",
        targetType: "Banner",
        targetId: banner.id,
        details: banner.title || banner.image_url,
        severity: "warning",
      });
      await load();
      toast({ title: "Banner removido" });
    } catch (error) {
      toast({ title: "Não foi possível remover", description: error.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5">
      <section className="card-surface space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">Novo banner</h2>
          <p className="text-[11px] text-muted-foreground">
            A imagem aparece no carrossel da página inicial. O link é o destino ao clicar: use o caminho da partida
            (por exemplo /partida/ID-DO-EVENTO) ou um link completo.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Imagem do banner</Label>
            <div className="flex flex-wrap items-center gap-3">
              <div className="h-24 w-40 overflow-hidden rounded-lg border border-border bg-secondary/40">
                <Image
                  src={form.image_url}
                  alt="Pré-visualização do banner"
                  fittingType="fit"
                  className="h-full w-full"
                />
              </div>
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
                {uploading ? "Enviando..." : "Enviar imagem"}
              </Button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="banner-title">Título (opcional)</Label>
            <Input
              id="banner-title"
              value={form.title}
              onChange={(event) => update({ title: event.target.value })}
              placeholder="Super odd: Flamengo x Atlético-MG"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="banner-link">Link do banner</Label>
            <Input
              id="banner-link"
              value={form.link_url}
              onChange={(event) => update({ link_url: event.target.value })}
              placeholder="/partida/ID-DO-EVENTO"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="banner-order">Ordem de exibição</Label>
            <Input
              id="banner-order"
              type="number"
              value={form.sort_order}
              onChange={(event) => update({ sort_order: event.target.value })}
            />
          </div>

          <label className="flex items-center justify-between gap-3 self-end rounded-lg border border-border px-3 py-2 text-sm">
            Banner ativo
            <Switch checked={form.active} onCheckedChange={(value) => update({ active: value })} />
          </label>
        </div>

        <Button onClick={create} disabled={saving}>
          {saving ? "Salvando..." : "Adicionar banner"}
        </Button>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Banners cadastrados</h2>
        {loading ? (
          <div className="card-surface h-32 animate-pulse" />
        ) : banners.length ? (
          <div className="space-y-2">
            {banners.map((banner) => (
              <div key={banner.id} className="card-surface flex flex-wrap items-center gap-3 p-3">
                <div className="h-16 w-28 shrink-0 overflow-hidden rounded-lg border border-border bg-secondary/40">
                  <Image src={banner.image_url} alt={banner.title || "Banner"} fittingType="fit" className="h-full w-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{banner.title || "Sem título"}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {banner.link_url || "sem link definido"} · ordem {banner.sort_order ?? 0}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Ativo
                  <Switch
                    checked={banner.active !== false}
                    onCheckedChange={(value) => patch(banner, { active: value })}
                    aria-label={`Ativar ${banner.title || "banner"}`}
                  />
                </label>
                <Button variant="ghost" size="icon" onClick={() => remove(banner)} aria-label="Remover banner">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum banner cadastrado ainda.</p>
        )}
      </section>
    </div>
  );
}
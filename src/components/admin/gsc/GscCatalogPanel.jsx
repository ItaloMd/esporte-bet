import React, { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { CATEGORY_LABEL, GAME_CATEGORIES } from "@/lib/gaming";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const EMPTY = { name: "", provider_name: "", game_code: "", category: "slots", image_url: "", launch_url: "" };

export default function GscCatalogPanel() {
  const { toast } = useToast();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await base44.entities.GamingGame.list({ sort: "-created_date", limit: 100 });
    setGames(result.items || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const set = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }));

  const create = async (event) => {
    event.preventDefault();
    if (!draft.name.trim()) return;
    setBusy(true);
    try {
      await base44.entities.GamingGame.create({
        ...draft,
        name: draft.name.trim(),
        provider_name: draft.provider_name.trim(),
        status: "published",
      });
      setDraft(EMPTY);
      setOpen(false);
      await load();
      toast({ title: "Jogo adicionado ao catálogo" });
    } catch (err) {
      toast({ variant: "destructive", title: "Não foi possível salvar", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (game) => {
    const status = game.status === "published" ? "draft" : "published";
    await base44.entities.GamingGame.update(game.id, { status });
    setGames((current) => current.map((item) => (item.id === game.id ? { ...item, status } : item)));
  };

  const remove = async (game) => {
    await base44.entities.GamingGame.delete(game.id);
    setGames((current) => current.filter((item) => item.id !== game.id));
  };

  return (
    <section className="card-surface space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Catálogo de jogos</h2>
          <p className="text-[11px] text-muted-foreground">
            {games.length} {games.length === 1 ? "jogo cadastrado" : "jogos cadastrados"} ·{" "}
            {games.filter((game) => game.status === "published").length} publicados
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Novo jogo
        </Button>
      </div>

      {open && (
        <form onSubmit={create} className="space-y-2.5 rounded-lg border border-border bg-secondary/20 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Nome do jogo</Label>
              <Input value={draft.name} onChange={set("name")} placeholder="Nome exibido no lobby" required />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Provedor</Label>
              <Input value={draft.provider_name} onChange={set("provider_name")} placeholder="PG Soft, Pragmatic Play..." />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Categoria</Label>
              <select className={SELECT_CLASS} value={draft.category} onChange={set("category")}>
                {GAME_CATEGORIES.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Código na GSC+</Label>
              <Input value={draft.game_code} onChange={set("game_code")} placeholder="game_code do provedor" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Capa (URL)</Label>
              <Input value={draft.image_url} onChange={set("image_url")} placeholder="https://..." />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Link de lançamento</Label>
              <Input value={draft.launch_url} onChange={set("launch_url")} placeholder="https://..." />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Salvando..." : "Adicionar"}
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="h-24 animate-pulse rounded-lg bg-secondary/40" />
      ) : games.length === 0 ? (
        <p className="rounded-lg border border-border px-3 py-6 text-center text-xs text-muted-foreground">
          Nenhum jogo cadastrado. Adicione manualmente ou aguarde a sincronização do catálogo do provedor.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {games.map((game) => (
            <li key={game.id} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{game.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {game.provider_name || "sem provedor"} · {CATEGORY_LABEL[game.category] || game.category}
                  {!game.launch_url && " · sem link de lançamento"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${
                  game.status === "published"
                    ? "border-primary/40 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {game.status === "published" ? "publicado" : "rascunho"}
              </span>
              <button
                type="button"
                onClick={() => toggleStatus(game)}
                className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={game.status === "published" ? `Despublicar ${game.name}` : `Publicar ${game.name}`}
              >
                {game.status === "published" ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => remove(game)}
                className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                aria-label={`Remover ${game.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
import React, { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import RelevanceList from "@/components/admin/football/RelevanceList";

const DEFAULT_SCORE = 40;

/**
 * Curadoria do calendário: quais campeonatos e equipes têm alta relevância.
 * A lista sai das partidas já importadas (custo zero de API) e a gravação é
 * seguida da repontuação das partidas, que também não consome cota.
 */
export default function RelevancePicker() {
  const [data, setData] = useState(null);
  const [competitions, setCompetitions] = useState({});
  const [teams, setTeams] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke("adminRelevance", { action: "catalog" });
      const payload = response.data || {};
      if (payload.error) throw new Error(payload.error);
      setData(payload);
      const comps = {};
      (payload.selected_competitions || []).forEach((row) => {
        comps[row.league_id || row.name] = Number(row.score) || DEFAULT_SCORE;
      });
      const picked = {};
      (payload.selected_teams || []).forEach((row) => {
        picked[row.team_id || row.name] = Number(row.score) || DEFAULT_SCORE;
      });
      setCompetitions(comps);
      setTeams(picked);
    } catch (error) {
      toast({ title: "Não foi possível carregar a seleção", description: error.message, variant: "destructive" });
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const competitionItems = useMemo(
    () =>
      (data?.competitions || []).map((row) => ({
        key: row.league_id || row.name,
        name: row.name,
        meta: `${row.country || "Internacional"} · ${row.matches} jogo(s) nos próximos dias`,
        raw: row,
      })),
    [data],
  );

  const teamItems = useMemo(
    () =>
      (data?.teams || []).map((row) => ({
        key: row.team_id || row.name,
        name: row.name,
        meta: `${row.matches} jogo(s) nos próximos dias`,
        raw: row,
      })),
    [data],
  );

  const toggle = (setter, defaultScore) => (item) =>
    setter((current) => {
      const next = { ...current };
      if (next[item.key] !== undefined) delete next[item.key];
      else next[item.key] = defaultScore;
      return next;
    });

  const changeScore = (setter) => (key, value) =>
    setter((current) => ({ ...current, [key]: Math.min(50, Math.max(0, Number(value) || 0)) }));

  const save = async () => {
    setSaving(true);
    try {
      const priority_competitions = competitionItems
        .filter((item) => competitions[item.key] !== undefined)
        .map((item) => ({
          league_id: item.raw.league_id || "",
          name: item.name,
          country: item.raw.country || "",
          group: item.raw.country === "Brazil" ? "br" : "intl",
          score: competitions[item.key],
        }));
      const priority_teams = teamItems
        .filter((item) => teams[item.key] !== undefined)
        .map((item) => ({
          team_id: item.raw.team_id || "",
          name: item.name,
          score: teams[item.key],
        }));

      const response = await base44.functions.invoke("adminRelevance", { action: "save", priority_competitions, priority_teams });
      if (response.data?.error) throw new Error(response.data.error);
      await base44.functions.invoke("syncFootball", { mode: "relevance", trigger: "manual" });
      toast({
        title: "Seleção salva",
        description: `${priority_competitions.length} campeonato(s) e ${priority_teams.length} equipe(s). Partidas repontuadas sem consumir cota.`,
      });
      await load();
    } catch (error) {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const totalCompetitions = Object.keys(competitions).length;
  const totalTeams = Object.keys(teams).length;

  return (
    <section className="card-surface space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Campeonatos e equipes de alta relevância</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            A seleção define a ordem da grade e quais partidas dos próximos 7 dias merecem prioridade. A lista vem das
            partidas já importadas: nenhuma chamada à API-Football é feita aqui.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading || saving}>
          {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
          Recarregar
        </Button>
      </div>

      {!data ? (
        <div className="h-32 animate-pulse rounded-lg bg-secondary/40" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-medium">Campeonatos importantes ({totalCompetitions})</p>
            <RelevanceList
              items={competitionItems}
              selected={competitions}
              onToggle={toggle(setCompetitions, DEFAULT_SCORE)}
              onScore={changeScore(setCompetitions)}
              placeholder="Buscar campeonato ou país"
              emptyLabel="Nenhuma partida futura importada ainda. Rode a importação do calendário."
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium">Equipes de alta relevância ({totalTeams})</p>
            <RelevanceList
              items={teamItems}
              selected={teams}
              onToggle={toggle(setTeams, 50)}
              onScore={changeScore(setTeams)}
              placeholder="Buscar equipe"
              emptyLabel="Nenhuma equipe nas partidas futuras importadas."
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={saving || loading}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar seleção
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Pontuação de 0 a 50: quanto maior, mais acima a partida aparece. Salvar não consome cota.
        </p>
      </div>
    </section>
  );
}
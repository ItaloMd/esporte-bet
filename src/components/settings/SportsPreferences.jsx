import React, { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { SPORTS } from "@/lib/sports";
import useCompetitions from "@/lib/useCompetitions";

export default function SportsPreferences({ profile, onSaved }) {
  const { competitions } = useCompetitions({ limit: 60 });
  const [sports, setSports] = useState(profile.favorite_sports || []);
  const [teams, setTeams] = useState(profile.favorite_teams || []);
  const [competitionsSelected, setCompetitionsSelected] = useState(profile.favorite_competitions || []);
  const [teamDraft, setTeamDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const toggle = (list, setList, value) => {
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await base44.entities.UserProfile.update(profile.id, {
        favorite_sports: sports,
        favorite_teams: teams,
        favorite_competitions: competitionsSelected,
      });
      toast({ title: "Preferências salvas" });
      onSaved?.();
    } catch (error) {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card-surface space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold">Preferências esportivas</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Usamos estas escolhas para destacar partidas e alertas relacionados aos seus interesses.
        </p>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Esportes favoritos</p>
        <div className="flex flex-wrap gap-2">
          {SPORTS.map((sport) => (
            <button
              key={sport.slug}
              type="button"
              onClick={() => toggle(sports, setSports, sport.slug)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                sports.includes(sport.slug) ? "border-primary text-primary" : "border-border text-muted-foreground"
              }`}
            >
              {sport.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Equipes favoritas</p>
        <div className="flex gap-2">
          <Input
            value={teamDraft}
            onChange={(event) => setTeamDraft(event.target.value)}
            placeholder="Nome da equipe"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (teamDraft.trim()) {
                  setTeams([...new Set([...teams, teamDraft.trim()])]);
                  setTeamDraft("");
                }
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (teamDraft.trim()) {
                setTeams([...new Set([...teams, teamDraft.trim()])]);
                setTeamDraft("");
              }
            }}
          >
            Adicionar
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {teams.map((team) => (
            <Badge key={team} variant="secondary" className="gap-1">
              {team}
              <button type="button" onClick={() => setTeams(teams.filter((item) => item !== team))} aria-label={`Remover ${team}`}>
                ×
              </button>
            </Badge>
          ))}
          {!teams.length && <p className="text-xs text-muted-foreground">Nenhuma equipe adicionada.</p>}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Competições favoritas</p>
        <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
          {competitions.map((competition) => (
            <label key={competition.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary/60">
              <span className="truncate">{competition.name}</span>
              <input
                type="checkbox"
                checked={competitionsSelected.includes(competition.id)}
                onChange={() => toggle(competitionsSelected, setCompetitionsSelected, competition.id)}
                className="h-4 w-4 accent-[hsl(var(--primary))]"
              />
            </label>
          ))}
          {!competitions.length && <p className="px-2 py-1 text-xs text-muted-foreground">Nenhuma competição disponível.</p>}
        </div>
      </div>

      <Button onClick={save} disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Salvar preferências
      </Button>
    </section>
  );
}
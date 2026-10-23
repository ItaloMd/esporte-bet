import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Send } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { formatDateTime } from "@/lib/format";

const TYPES = [
  { value: "access", label: "Acesso aos meus dados" },
  { value: "correction", label: "Correção cadastral" },
  { value: "deletion", label: "Exclusão de dados" },
  { value: "consent", label: "Gerenciar consentimentos" },
  { value: "support", label: "Atendimento" },
];

const STATUS_LABEL = { pending: "Pendente", in_review: "Em análise", completed: "Concluída", rejected: "Recusada" };

export default function PrivacySection({ userId, profile }) {
  const [requests, setRequests] = useState([]);
  const [type, setType] = useState("access");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const load = () => {
    base44.entities.PrivacyRequest.filter({ user_id: userId }, { sort: "-created_date", limit: 10 })
      .then((page) => setRequests(page.items || []))
      .catch(() => setRequests([]));
  };

  useEffect(() => {
    if (userId) load();
  }, [userId]);

  const submit = async (event) => {
    event.preventDefault();
    setSending(true);
    try {
      await base44.entities.PrivacyRequest.create({ user_id: userId, type, message: message.trim() });
      setMessage("");
      toast({ title: "Solicitação registrada", description: "O administrador acompanha e responde por aqui." });
      load();
    } catch (error) {
      toast({ title: "Não foi possível registrar", description: error.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="card-surface space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Privacidade</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Consulte a <Link to="/privacidade" className="text-primary hover:underline">política de privacidade</Link> e os{" "}
          <Link to="/termos" className="text-primary hover:underline">termos de uso</Link>.
        </p>
        {profile?.terms_accepted_at && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Termos e política aceitos em {formatDateTime(profile.terms_accepted_at)}.
          </p>
        )}
      </div>

      <form onSubmit={submit} className="space-y-2">
        <label className="block text-xs font-medium text-muted-foreground" htmlFor="request-type">
          Tipo de solicitação
        </label>
        <select
          id="request-type"
          value={type}
          onChange={(event) => setType(event.target.value)}
          className="h-10 w-full rounded-lg border border-border bg-secondary/60 px-2.5 text-sm"
        >
          {TYPES.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Descreva sua solicitação (opcional para acesso e exclusão)"
          rows={3}
        />
        <Button type="submit" disabled={sending}>
          {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Registrar solicitação
        </Button>
      </form>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Minhas solicitações</p>
        {requests.length ? (
          requests.map((request) => (
            <div key={request.id} className="rounded-lg border border-border px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{TYPES.find((item) => item.value === request.type)?.label || request.type}</span>
                <span className="text-muted-foreground">{STATUS_LABEL[request.status] || request.status}</span>
              </div>
              <p className="mt-0.5 text-muted-foreground">{formatDateTime(request.created_date)}</p>
              {request.response && <p className="mt-1 text-foreground/80">Resposta: {request.response}</p>}
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">Nenhuma solicitação registrada.</p>
        )}
      </div>
    </section>
  );
}
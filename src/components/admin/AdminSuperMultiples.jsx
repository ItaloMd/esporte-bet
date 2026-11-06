import React, { useState } from "react";
import MultipleForm from "@/components/admin/superMultiples/MultipleForm";
import MultipleList from "@/components/admin/superMultiples/MultipleList";

/** Configuração das super múltiplas: montagem das seleções e publicação. */
export default function AdminSuperMultiples() {
  const [editing, setEditing] = useState(null);
  const [revision, setRevision] = useState(0);

  const handleSaved = () => {
    setEditing(null);
    setRevision((current) => current + 1);
  };

  return (
    <div className="space-y-4">
      <MultipleForm
        key={editing?.id || "new"}
        initial={editing}
        onSaved={handleSaved}
        onCancel={() => setEditing(null)}
      />
      <MultipleList revision={revision} onEdit={setEditing} />
    </div>
  );
}
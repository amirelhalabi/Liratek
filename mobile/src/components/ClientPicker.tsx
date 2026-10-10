import { useEffect, useState } from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";

import { NO_CONNECTION } from "@/api/client";
import { createClient, searchClients, type ClientSummary } from "@/api/clients";
import { TextField } from "@/components/TextField";
import { useTheme } from "@/theme/ThemeProvider";
import { radius, spacing } from "@/theme/tokens";

/**
 * The customer part of a phone sale: search the shop's clients, or type a new
 * client's name and phone. Shared by the transfer form and the catalog cart
 * (LIRA-302) so both find and create clients the same way.
 */
export function useClientPicker() {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ClientSummary[]>([]);
  const [client, setClient] = useState<ClientSummary | null>(null);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  useEffect(() => {
    if (client || query.trim().length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchClients(query.trim()).then((r) => {
        if (!cancelled && r.success) setMatches(r.data.slice(0, 6));
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, client]);

  const name = client?.full_name ?? newName.trim();
  const phone = client?.phone_number ?? newPhone.trim();

  /**
   * The client id to book with: the chosen client, or a new client created
   * from the typed name and phone, or null when neither was given.
   */
  async function ensureClient(): Promise<{ ok: true; id: number | null } | { ok: false; error: string }> {
    if (client) return { ok: true, id: client.id };
    if (!name || !phone) return { ok: true, id: null };
    const created = await createClient({ full_name: name, phone_number: phone, whatsapp_opt_in: false });
    if (!created.success) {
      return {
        ok: false,
        error:
          created.error === NO_CONNECTION
            ? "Not saved — no connection. Check your internet and tap Save again."
            : `Could not register the client: ${created.error}`,
      };
    }
    setClient({ id: created.data, full_name: name, phone_number: phone });
    return { ok: true, id: created.data };
  }

  return { query, setQuery, matches, setMatches, client, setClient, newName, setNewName, newPhone, setNewPhone, name, phone, ensureClient };
}

export type ClientPickerState = ReturnType<typeof useClientPicker>;

export function ClientPicker({ picker }: { picker: ClientPickerState }) {
  const t = useTheme();
  if (picker.client) {
    return (
      <View style={[styles.chosen, { borderColor: t.border }]}>
        <View style={styles.flex}>
          <Text style={{ color: t.text, fontWeight: "600" }}>{picker.client.full_name}</Text>
          <Text style={{ color: t.textMuted }}>{picker.client.phone_number}</Text>
        </View>
        <Pressable
          onPress={() => {
            picker.setClient(null);
            picker.setQuery("");
          }}
          hitSlop={10}
        >
          <Text style={{ color: t.link, fontWeight: "600" }}>Change</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <>
      <TextField label="Search clients" value={picker.query} onChangeText={picker.setQuery} placeholder="Name or phone" autoCorrect={false} />
      {picker.matches.map((m) => (
        <Pressable
          key={m.id}
          onPress={() => {
            picker.setClient(m);
            picker.setMatches([]);
            // The search is done: close the keyboard so the rest of the form is visible.
            Keyboard.dismiss();
          }}
          style={[styles.match, { borderColor: t.border }]}
        >
          <Text style={{ color: t.text }}>{m.full_name}</Text>
          <Text style={{ color: t.textMuted }}>{m.phone_number}</Text>
        </Pressable>
      ))}
      <Text style={{ color: t.textMuted, fontSize: 13 }}>Or a new client:</Text>
      <TextField label="Name" value={picker.newName} onChangeText={picker.setNewName} />
      <TextField label="Phone" value={picker.newPhone} onChangeText={picker.setNewPhone} keyboardType="phone-pad" />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chosen: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  match: { flexDirection: "row", justifyContent: "space-between", borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
});

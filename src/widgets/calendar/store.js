// Where the Calendar keeps its entries. In the app this is a file in the app's data folder
// (written safely by the Rust side). In a plain browser (development) it falls back to
// localStorage so the widget still works.
import { T } from "../../shared/widget.js";
import { serialize, parseBackup } from "./model.js";

const LS_KEY = "calendar.entries.v1";
const BACKUP_FILTER = [{ name: "Calendar backup", extensions: ["json"] }];

export const inApp = () => !!(T && T.core);

export function createStore() {
  return {
    /** -> { entries, dropped }. Throws if the saved data cannot be read, so the app can refuse to overwrite it. */
    async load() {
      const text = inApp() ? await T.core.invoke("calendar_load") : localStorage.getItem(LS_KEY);
      return text ? parseBackup(text) : { entries: [], dropped: 0 };
    },
    async save(entries) {
      const text = serialize(entries);
      if (inApp()) await T.core.invoke("calendar_save", { json: text });
      else localStorage.setItem(LS_KEY, text);
    },
    canBackup: () => inApp() && !!T.dialog,
    /** Ask where to save a backup, then write it. Returns false if the user cancelled. */
    async exportBackup() {
      const path = await T.dialog.save({ defaultPath: "Calendar backup.json", filters: BACKUP_FILTER });
      if (!path) return false;
      await T.core.invoke("calendar_export", { path });
      return true;
    },
    /** Ask for a backup file and read it. Returns null if cancelled, else { entries, dropped }. */
    async chooseBackup() {
      const path = await T.dialog.open({ multiple: false, filters: BACKUP_FILTER });
      if (!path) return null;
      return parseBackup(await T.core.invoke("calendar_import", { path }));
    },
  };
}

"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * Holds the note from the last bank payment answer, such as "rule already exists".
 * It sits above the list because an answered payment leaves the list, and its form with it.
 */
const NoticeContext = createContext<((notice: string) => void) | null>(null);

export function useDebitNotice() {
  return useContext(NoticeContext);
}

export function DebitNotices({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<string>();
  return (
    <NoticeContext.Provider value={setNotice}>
      {notice && (
        <p className="notice" role="status">
          {notice}{" "}
          <button type="button" className="small secondary" onClick={() => setNotice(undefined)}>OK</button>
        </p>
      )}
      {children}
    </NoticeContext.Provider>
  );
}

import React from "react";
import { createRoot } from "react-dom/client";
import { PnlCardsApp } from "../pnl-cards/src/App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PnlCardsApp />
  </React.StrictMode>
);

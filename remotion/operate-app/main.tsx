import React from "react";
import { createRoot } from "react-dom/client";
import { OperateTools } from "../src/operate-tools/OperateTools";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OperateTools />
  </React.StrictMode>
);

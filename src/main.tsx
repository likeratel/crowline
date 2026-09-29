import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { TrayPanel } from "./components/TrayPanel";
import "./styles/responsive.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get("view") === "dashboard" ? (
      <App />
    ) : (
      <TrayPanel />
    )}
  </React.StrictMode>,
);

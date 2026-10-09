import React from "react";
import ReactDOM from "react-dom/client";
import { AppBootstrap } from "./AppBootstrap";
import "./App.css";
import "./styles/responsive.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppBootstrap />
  </React.StrictMode>,
);

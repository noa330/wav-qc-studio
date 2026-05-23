import React from "react";
import ReactDOM from "react-dom/client";
import "@/styles/globals.css";
import "./startup-splash.css";
import { StartupSplash } from "./StartupSplash";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StartupSplash />
  </React.StrictMode>,
);

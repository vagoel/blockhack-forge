import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { convex } from "./convexClient";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </React.StrictMode>,
);

import { useEffect, useState } from "react";
import { useCompileWorker } from "./compileWorker";
import BuildView from "./views/BuildView";
import GalleryView from "./views/GalleryView";
import ProjectorView from "./views/ProjectorView";
import StudioSidebar from "./components/StudioSidebar";

type Route =
  | { view: "build"; buildId: string | null }
  | { view: "gallery" }
  | { view: "projector"; slug: string };

function parseRoute(): Route {
  const parts = window.location.hash
    .replace(/^#/, "")
    .split("/")
    .filter(Boolean);
  if (parts[0] === "projector" && parts[1]) {
    return { view: "projector", slug: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "gallery") return { view: "gallery" };
  if (parts[0] === "recent" || parts[0] === "builds") return { view: "gallery" };
  if (parts[0] === "build" && parts[1]) {
    return { view: "build", buildId: parts[1] };
  }
  return { view: "build", buildId: null };
}

export default function App() {
  return <ConsoleApp />;
}

function ConsoleApp() {
  const [route, setRoute] = useState<Route>(parseRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Compile in-browser while a console tab is open. Deploys and CI
  // can use the equivalent `pnpm compile` headless path.
  const worker = useCompileWorker();

  if (route.view === "projector") {
    return <ProjectorView slug={route.slug} />;
  }

  return (
    <div className="studio-shell">
      <StudioSidebar active={route.view} worker={worker} />
      <div className="studio-workspace">
        <header className="mobile-studio-bar">
          <a className="mobile-brand" href="#/build">
            <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
            <strong>Builder</strong>
          </a>
          <nav aria-label="Mobile studio navigation">
            <a className={route.view === "build" ? "is-active" : ""} href="#/build">Create</a>
            <a className={route.view === "gallery" ? "is-active" : ""} href="#/gallery">Projects</a>
          </nav>
        </header>
        <main className={`studio-main studio-main-${route.view}`}>
        {route.view === "build" && <BuildView buildId={route.buildId} />}
        {route.view === "gallery" && <GalleryView />}
        </main>
      </div>
    </div>
  );
}

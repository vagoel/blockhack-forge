import { useEffect, useState } from "react";
import { useCompileWorker } from "./compileWorker";
import BuildView from "./views/BuildView";
import GalleryView from "./views/GalleryView";
import RecentBuildsView from "./views/RecentBuildsView";
import ProjectorView from "./views/ProjectorView";
import StudioSidebar from "./components/StudioSidebar";
import {
  forgetOperatorKey,
  loadOperatorKey,
  OperatorProvider,
  OperatorUnlock,
} from "./operator";

type Route =
  | { view: "build"; buildId: string | null }
  | { view: "gallery" }
  | { view: "recent" }
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
  if (parts[0] === "recent" || parts[0] === "builds") return { view: "recent" };
  if (parts[0] === "build" && parts[1]) {
    return { view: "build", buildId: parts[1] };
  }
  return { view: "build", buildId: null };
}

export default function App() {
  const [operatorKey, setOperatorKey] = useState(loadOperatorKey);

  if (!operatorKey) return <OperatorUnlock onUnlock={setOperatorKey} />;

  return (
    <OperatorProvider operatorKey={operatorKey}>
      <ConsoleApp
        onLock={() => {
          forgetOperatorKey();
          setOperatorKey("");
        }}
      />
    </OperatorProvider>
  );
}

function ConsoleApp({ onLock }: { onLock: () => void }) {
  const [route, setRoute] = useState<Route>(parseRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Compile in-browser while an unlocked console tab is open. Deploys and CI
  // can use the equivalent `pnpm compile` headless path.
  const worker = useCompileWorker();

  if (route.view === "projector") {
    return <ProjectorView slug={route.slug} />;
  }

  return (
    <div className="studio-shell">
      <StudioSidebar active={route.view} worker={worker} onLock={onLock} />
      <div className="studio-workspace">
        <header className="mobile-studio-bar">
          <a className="mobile-brand" href="#/build">
            <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
            <strong>Builder</strong>
          </a>
          <nav aria-label="Mobile studio navigation">
            <a className={route.view === "build" ? "is-active" : ""} href="#/build">Create</a>
            <a className={route.view === "gallery" ? "is-active" : ""} href="#/gallery">Projects</a>
            <a className={route.view === "recent" ? "is-active" : ""} href="#/recent">Activity</a>
          </nav>
          <button type="button" onClick={onLock} aria-label="Lock studio">⌁</button>
        </header>
        <main className={`studio-main studio-main-${route.view}`}>
        {route.view === "build" && <BuildView buildId={route.buildId} />}
        {route.view === "gallery" && <GalleryView />}
        {route.view === "recent" && <RecentBuildsView />}
        </main>
      </div>
    </div>
  );
}

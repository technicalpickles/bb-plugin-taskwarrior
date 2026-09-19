import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { rpcContract } from "../../contract";

export function useProjectLink(projectId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [twProject, setTwProject] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    if (projectId === null) {
      setTwProject(null);
      setLoaded(true);
      return;
    }
    void rpc.call("project_link_get", { projectId }).then((out) => {
      if (cancelled) return;
      setTwProject(out.twProject);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return {
    twProject,
    loaded,
    async setLink(name: string | null) {
      if (projectId === null) return;
      await rpc.call("project_link_set", { projectId, twProject: name });
      setTwProject(name);
    },
  };
}

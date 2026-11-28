import { createFileRoute } from "@tanstack/react-router";

import { ProjectTodosPage } from "../components/t4/todo/ProjectTodosPage";

export const Route = createFileRoute("/_chat/todos")({
  component: ProjectTodosPage,
});

// Opens a project the way a person does now: from the sidebar's Project menu.
export async function openProject(page, name) {
  const sidebar = page.locator(".dk-tsb");
  await sidebar.getByRole("button", { name: "Project", exact: true }).click();
  await sidebar.getByRole("option", { name, exact: typeof name === "string" }).click();
}

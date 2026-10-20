// Reaches a project section the way a person does now that the tab row is gone.
export async function goTo(page, section) {
  const sidebar = page.locator(".dk-tsb");
  if (section === "Tasks") return sidebar.getByRole("tab", { name: "Board" }).click();
  if (section === "Work") return sidebar.getByRole("tab", { name: "Now" }).click();
  if (section === "Memory") return page.locator(".dk-header").getByRole("button", { name: "Memory", exact: true }).click();
  if (section === "Schedule" || section === "Watch") {
    await page.locator(".dk-statusbar").getByRole("button", { name: /^Automations/ }).click();
    if (section === "Watch") await page.getByRole("tablist", { name: "Automations" }).getByRole("tab", { name: /^Watches/ }).click();
    return;
  }
  const option = { Overview: "Overview", Review: "Review queue", Activity: "Activity" }[section];
  if (!option) throw new Error(`goTo: no way to reach ${section}`);
  await page.locator(".dk-header").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(`^${option}`) }).click();
}

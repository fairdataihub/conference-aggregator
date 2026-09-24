export default defineEventHandler((event) => {
  // Drop the query string so tokens (e.g. email verification) never reach the logs
  console.log("New request: " + event.path.split("?")[0]);
});

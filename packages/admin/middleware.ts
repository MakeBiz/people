export { default } from "next-auth/middleware";

// Защищаем всё, кроме страницы логина, статики и эндпоинтов авторизации
export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};

<?php
declare(strict_types=1);

namespace DuskDex;

use DuskDex\Kernel\Database;
use DuskDex\Kernel\Env;
use DuskDex\Kernel\HttpException;
use DuskDex\Kernel\Request;
use DuskDex\Kernel\Response;
use DuskDex\Kernel\Router;
use DuskDex\Kernel\Security;
use DuskDex\Modules\Assets\AssetController as Assets;
use DuskDex\Modules\Auth\AuthController as Auth;
use DuskDex\Modules\Community\NotificationController as Notifications;
use DuskDex\Modules\Community\PostController as Posts;
use DuskDex\Modules\Community\PublicController as Pub;
use DuskDex\Modules\Inventory\InventoryController as Inventory;
use DuskDex\Modules\Trades\TradeController as Trades;
use DuskDex\Modules\Users\ImportController as Import;
use DuskDex\Modules\Binders\BinderController as Binders;
use DuskDex\Modules\Catalog\CardController as Cards;
use DuskDex\Modules\Collection\CopyController as Copies;
use DuskDex\Modules\Decks\DeckController as Decks;
use DuskDex\Modules\Inventory\LocationController as Locations;
use DuskDex\Modules\Users\ProfileController as Profile;
use DuskDex\Modules\Wishlist\WishlistController as Wishlist;

/** Front controller da API REST /api/v1. */
final class App
{
    public const VERSION = '1.0.0';

    public static function routes(): Router
    {
        $r = new Router();
        $r->add('GET', '/health', [self::class, 'health'], false);
        $r->add('GET', '/auth/csrf', [Auth::class, 'csrf'], false);
        $r->add('POST', '/auth/register', [Auth::class, 'register'], false);
        $r->add('POST', '/auth/login', [Auth::class, 'login'], false);
        $r->add('POST', '/auth/logout', [Auth::class, 'logout'], false);
        $r->add('GET', '/auth/me', [Auth::class, 'me']);
        $r->add('POST', '/auth/forgot', [Auth::class, 'forgot'], false);
        $r->add('POST', '/auth/reset', [Auth::class, 'reset'], false);
        $r->add('POST', '/auth/verify', [Auth::class, 'verify'], false);
        $r->add('POST', '/auth/verify/resend', [Auth::class, 'resendVerification']);

        $r->add('GET', '/users/me', [Profile::class, 'show']);
        $r->add('PATCH', '/users/me', [Profile::class, 'update']);
        $r->add('DELETE', '/users/me', [Auth::class, 'deleteAccount']);
        $r->add('POST', '/users/me/password', [Auth::class, 'changePassword']);
        $r->add('GET', '/users/me/export', [Profile::class, 'export']);
        $r->add('POST', '/users/me/import', [Import::class, 'import']);
        $r->add('GET', '/activity', [Profile::class, 'activity']);

        $r->add('GET', '/assets', [Assets::class, 'index']);
        $r->add('POST', '/assets', [Assets::class, 'store']);
        $r->add('GET', '/assets/{id}/file', [Assets::class, 'file'], false);
        $r->add('GET', '/assets/{id}/usage', [Assets::class, 'usage']);
        $r->add('DELETE', '/assets/{id}', [Assets::class, 'destroy']);

        $r->add('GET', '/cards', [Cards::class, 'index']);
        $r->add('POST', '/cards', [Cards::class, 'store']);

        $r->add('GET', '/collection/copies', [Copies::class, 'index']);
        $r->add('POST', '/collection/copies', [Copies::class, 'store']);
        $r->add('POST', '/collection/copies/remove', [Copies::class, 'remove']);
        $r->add('POST', '/collection/copies/trade', [Copies::class, 'tradeFlag']);
        $r->add('POST', '/collection/copies/condition', [Copies::class, 'setCondition']);

        $r->add('GET', '/storage-locations', [Locations::class, 'index']);
        $r->add('POST', '/storage-locations', [Locations::class, 'store']);
        $r->add('PATCH', '/storage-locations/{id}', [Locations::class, 'update']);
        $r->add('DELETE', '/storage-locations/{id}', [Locations::class, 'destroy']);
        $r->add('GET', '/inventory/batches', [Locations::class, 'batches']);
        $r->add('POST', '/inventory/move/preview', [Inventory::class, 'previewMove']);
        $r->add('POST', '/inventory/move', [Inventory::class, 'commitMove']);
        $r->add('GET', '/inventory/batches/{id}/revert-preview', [Inventory::class, 'previewRevert']);
        $r->add('POST', '/inventory/batches/{id}/revert', [Inventory::class, 'revert']);

        $r->add('GET', '/binders', [Binders::class, 'index']);
        $r->add('POST', '/binders', [Binders::class, 'store']);
        $r->add('GET', '/binders/{id}', [Binders::class, 'show']);
        $r->add('PATCH', '/binders/{id}', [Binders::class, 'update']);
        $r->add('DELETE', '/binders/{id}', [Binders::class, 'destroy']);
        $r->add('POST', '/binders/{id}/ops', [Binders::class, 'ops']);
        $r->add('POST', '/binders/{id}/duplicate', [Binders::class, 'duplicate']);

        $r->add('GET', '/wishlist', [Wishlist::class, 'index']);
        $r->add('POST', '/wishlist', [Wishlist::class, 'store']);
        $r->add('PATCH', '/wishlist/{id}', [Wishlist::class, 'update']);
        $r->add('DELETE', '/wishlist/{id}', [Wishlist::class, 'destroy']);

        $r->add('GET', '/decks', [Decks::class, 'index']);
        $r->add('POST', '/decks', [Decks::class, 'store']);
        $r->add('GET', '/decks/{id}', [Decks::class, 'show']);
        $r->add('PUT', '/decks/{id}', [Decks::class, 'update']);
        $r->add('DELETE', '/decks/{id}', [Decks::class, 'destroy']);
        $r->add('POST', '/decks/{id}/reserve', [Decks::class, 'reserve']);
        $r->add('POST', '/decks/{id}/release', [Decks::class, 'release']);
        $r->add('POST', '/decks/{id}/assemble', [Decks::class, 'assemble']);
        $r->add('POST', '/decks/{id}/disassemble', [Decks::class, 'disassemble']);

        // comunidade (leitura pública; escrita exige conta)
        $r->add('GET', '/community/feed', [Posts::class, 'feed'], false);
        $r->add('POST', '/community/posts', [Posts::class, 'store']);
        $r->add('GET', '/community/posts/{id}', [Posts::class, 'show'], false);
        $r->add('DELETE', '/community/posts/{id}', [Posts::class, 'destroy']);
        $r->add('POST', '/community/posts/{id}/like', [Posts::class, 'like']);
        $r->add('DELETE', '/community/posts/{id}/like', [Posts::class, 'like']);
        $r->add('GET', '/community/posts/{id}/comments', [Posts::class, 'comments'], false);
        $r->add('POST', '/community/posts/{id}/comments', [Posts::class, 'comment']);
        $r->add('DELETE', '/community/comments/{id}', [Posts::class, 'deleteComment']);
        $r->add('POST', '/community/reports', [Posts::class, 'report']);
        $r->add('GET', '/community/users', [Pub::class, 'search'], false);
        $r->add('GET', '/community/u/{username}', [Pub::class, 'profile'], false);
        $r->add('GET', '/community/u/{username}/posts', [Posts::class, 'byUser'], false);
        $r->add('GET', '/community/u/{username}/connections', [Pub::class, 'connections'], false);
        $r->add('POST', '/community/u/{username}/follow', [Pub::class, 'follow']);
        $r->add('DELETE', '/community/u/{username}/follow', [Pub::class, 'follow']);
        $r->add('POST', '/community/u/{username}/block', [Pub::class, 'block']);
        $r->add('DELETE', '/community/u/{username}/block', [Pub::class, 'block']);
        $r->add('GET', '/community/u/{username}/tradable', [Trades::class, 'tradable']);
        $r->add('GET', '/public/binders/{id}', [Pub::class, 'binder'], false);
        $r->add('GET', '/public/decks/{id}', [Pub::class, 'deck'], false);

        $r->add('GET', '/notifications', [Notifications::class, 'index']);
        $r->add('GET', '/notifications/count', [Notifications::class, 'count']);
        $r->add('POST', '/notifications/read', [Notifications::class, 'markRead']);
        $r->add('GET', '/admin/reports', [Notifications::class, 'reports']);
        $r->add('POST', '/admin/reports/{id}', [Notifications::class, 'resolve']);

        // trocas
        $r->add('GET', '/trades', [Trades::class, 'index']);
        $r->add('POST', '/trades', [Trades::class, 'store']);
        $r->add('GET', '/trades/{id}', [Trades::class, 'show']);
        $r->add('POST', '/trades/{id}/accept', [Trades::class, 'accept']);
        $r->add('POST', '/trades/{id}/decline', [Trades::class, 'decline']);
        $r->add('POST', '/trades/{id}/cancel', [Trades::class, 'cancel']);
        return $r;
    }

    public static function health(Request $req): array
    {
        try {
            Database::one('SELECT 1');
            $migrated = (bool) Database::one("SHOW TABLES LIKE 'users'");
            $complete = $migrated && (bool) Database::one("SHOW COLUMNS FROM trade_items LIKE 'card_condition'");
            return ['api' => 'ok', 'database' => !$migrated ? 'not_migrated' : ($complete ? 'ok' : 'outdated'), 'version' => self::VERSION,
                'maxUpload' => Assets::maxUpload(), 'requireVerifiedEmail' => Env::bool('REQUIRE_VERIFIED_EMAIL'),
                // e-mails só gravados em arquivo (desenvolvimento): o site oferece confirmar sem e-mail
                'mailTestMode' => \DuskDex\Kernel\Mailer::testMode() && Env::get('APP_ENV') !== 'production'];
        } catch (\Throwable $e) {
            // detalhe da causa só fora de produção (ajuda a configurar o XAMPP/servidor)
            $reason = Env::get('APP_ENV') === 'production' ? null : Database::diagnose($e);
            return ['api' => 'ok', 'database' => 'unavailable', 'version' => self::VERSION, 'reason' => $reason];
        }
    }

    public static function handle(): void
    {
        $requestId = bin2hex(random_bytes(6));
        header('X-Request-Id: ' . $requestId);
        Response::securityHeaders();
        try {
            $req = Request::fromGlobals();
            $route = self::routes()->match($req);
            if (!$route) {
                throw new HttpException(404, 'ROUTE_NOT_FOUND', 'Rota da API não encontrada.');
            }
            Security::startSession();
            Security::validateSession();
            if ($route['auth'] && !Security::userId()) {
                throw HttpException::unauthenticated();
            }
            Security::verifyCsrf($req);
            if (!in_array($req->method, ['GET', 'HEAD', 'OPTIONS'], true)) {
                // teto geral de escritas (protege o banco de contas abusivas e scripts); limites específicos continuam valendo
                $uid = Security::userId();
                $uid ? Security::rateLimit('writes:' . $uid, Env::int('RATE_WRITES_PER_HOUR', 2000), 3600)
                     : Security::rateLimit('writes-anon:' . Security::ipHash(), 300, 3600);
            }
            $status = $req->method === 'POST' && in_array($req->path, ['/binders', '/decks', '/storage-locations', '/collection/copies', '/assets', '/community/posts', '/trades'], true) ? 201 : 200;
            $out = ($route['handler'])($req);
            if (!Response::$sent) {
                Response::json($out, $status);
            }
        } catch (HttpException $e) {
            Response::error($e->status, $e->errorCode, $e->getMessage(), $e->details, $requestId);
        } catch (\Throwable $e) {
            error_log("[DuskDex $requestId] " . $e);
            $debug = Env::bool('APP_DEBUG') && Env::get('APP_ENV') !== 'production';
            $dbDown = $e instanceof \PDOException && str_contains($e->getMessage(), 'SQLSTATE[HY000] [');
            Response::error($dbDown ? 503 : 500, $dbDown ? 'DATABASE_UNAVAILABLE' : 'INTERNAL', $dbDown ? 'Banco de dados indisponível. Verifique a configuração do MySQL no .env.' : 'Erro interno do servidor.', $debug ? [['exception' => get_class($e), 'message' => $e->getMessage()]] : [], $requestId);
        }
    }
}

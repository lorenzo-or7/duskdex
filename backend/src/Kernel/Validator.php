<?php
declare(strict_types=1);

namespace DuskDex\Kernel;

/** Validação de entrada explícita (nunca confiar no frontend). */
final class Validator
{
    private array $errors = [];

    public function __construct(private readonly array $data) {}

    public function str(string $key, int $min = 0, int $max = 255, bool $required = true, ?string $pattern = null, string $label = ''): ?string
    {
        $v = $this->data[$key] ?? null;
        $label = $label ?: $key;
        if ($v === null || $v === '') {
            if ($required) { $this->errors[] = ['field' => $key, 'message' => "$label é obrigatório."]; }
            return null;
        }
        if (!is_string($v) && !is_int($v)) { $this->errors[] = ['field' => $key, 'message' => "$label inválido."]; return null; }
        $v = trim((string) $v);
        $len = mb_strlen($v);
        if ($len < $min || $len > $max) { $this->errors[] = ['field' => $key, 'message' => "$label deve ter entre $min e $max caracteres."]; }
        if ($pattern !== null && !preg_match($pattern, $v)) { $this->errors[] = ['field' => $key, 'message' => "$label em formato inválido."]; }
        return $v;
    }

    public function int(string $key, int $min, int $max, bool $required = true, ?int $default = null): ?int
    {
        $v = $this->data[$key] ?? null;
        if ($v === null || $v === '') {
            if ($required) { $this->errors[] = ['field' => $key, 'message' => "$key é obrigatório."]; }
            return $default;
        }
        if (!is_numeric($v) || (int) $v != $v) { $this->errors[] = ['field' => $key, 'message' => "$key deve ser inteiro."]; return $default; }
        $v = (int) $v;
        if ($v < $min || $v > $max) { $this->errors[] = ['field' => $key, 'message' => "$key deve estar entre $min e $max."]; }
        return $v;
    }

    public function in(string $key, array $allowed, bool $required = true, ?string $default = null): ?string
    {
        $v = $this->data[$key] ?? null;
        if ($v === null || $v === '') {
            if ($required) { $this->errors[] = ['field' => $key, 'message' => "$key é obrigatório."]; }
            return $default;
        }
        if (!in_array($v, $allowed, true)) { $this->errors[] = ['field' => $key, 'message' => "$key inválido."]; return $default; }
        return $v;
    }

    public function email(string $key): ?string
    {
        $v = $this->str($key, 5, 190, true, null, 'E-mail');
        if ($v !== null && !filter_var($v, FILTER_VALIDATE_EMAIL)) { $this->errors[] = ['field' => $key, 'message' => 'E-mail inválido.']; }
        return $v !== null ? mb_strtolower($v) : null;
    }

    public function check(): void
    {
        if ($this->errors) {
            throw HttpException::validation('Revise os campos destacados.', $this->errors);
        }
    }
}

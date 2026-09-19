# Сырые HTML-выжимки интерфейса DeepSeek

> **Назначение:** справочный материал для отладки и анализа структуры DOM.  
> **Актуальность:** 2026-09-18.

---

## 0. Страница входа (Sign In)

### 0.1. Форма входа

```html
<div class="ds-sign-in-form__main">
  <div class="ds-auth-form__main-hero">
    <!-- Поле Email/Phone -->
    <div class="ds-form-item ds-form-item--none ds-form-item--label-m">
      <div class="ds-form-item__content">
        <div class="ds-input ds-input--none ds-input--bordered ds-input--l ds-input--roundRect ds-input--transition" style="--dsl-input-padding: 0 20px 0 16px;">
          <input type="text" class="ds-input__input" placeholder="Phone number / email address" size="1" value="">
        </div>
      </div>
      <div class="ds-form-item__feedback" data-transform-origin="top"></div>
    </div>

    <!-- Поле Password -->
    <div class="ds-form-item ds-form-item--none ds-form-item--label-m">
      <div class="ds-form-item__content">
        <div class="ds-input ds-input--none ds-input--bordered ds-input--l ds-input--roundRect ds-input--transition" style="--dsl-input-padding: 0 20px 0 16px;">
          <input type="password" class="ds-input__input" placeholder="Password" size="1" value="">
          <div class="ds-input__password-toggle">
            <div role="button" class="ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--xs ds-button--icon-relative-l ds-button--sizing-content" tabindex="0">
              <div class="ds-button__background"></div>
              <div class="ds-button__icon ds-button__icon--last-child">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M15.0146 8.3086C11.7816 13.697 4.21836 13.697 0.98532 8.3086C0.871428 8.11866 0.871431 7.88135 0.98532 7.69141C4.21836 2.30301 11.7816 2.303 15.0146 7.69141C15.1285 7.88135 15.1285 8.11866 15.0146 8.3086ZM2.21091 8C5.00794 12.1994 10.9932 12.1997 13.79 8C10.9932 3.80031 5.00794 3.80061 2.21091 8Z" fill="currentColor"></path>
                  <path d="M9.40036 8C9.40036 7.2268 8.77317 6.59961 7.99997 6.59961C7.22677 6.59961 6.59958 7.2268 6.59958 8C6.59958 8.7732 7.22677 9.40039 7.99997 9.40039C8.77317 9.40039 9.40036 8.7732 9.40036 8ZM10.5996 8C10.5996 9.43594 9.43591 10.5996 7.99997 10.5996C6.56403 10.5996 5.40036 9.43594 5.40036 8C5.40036 6.56406 6.56403 5.40039 7.99997 5.40039C9.43591 5.40039 10.5996 6.56406 10.5996 8Z" fill="currentColor"></path>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="ds-form-item__feedback" data-transform-origin="top"></div>
    </div>

    <!-- Terms -->
    <div class="ds-form-item ds-form-item--none ds-form-item--label-m ds-sign-up-form__agreement-text">
      <div class="ds-form-item__content">
        By signing up or logging in, you consent to DeepSeek's
        <a href="https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html?locale=en_US" target="_blank" rel="noopener noreferrer" class="ds-a ds-a--link">
          Terms of Use
        </a>
        and
        <a href="https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html?locale=en_US" target="_blank" rel="noopener noreferrer" class="ds-a ds-a--link">
          Privacy Policy
        </a>.
      </div>
    </div>

    <!-- Кнопки -->
    <div class="ds-sign-in-form__form-footer">
      <div role="button" class="ds-button ds-button--textInheritedPrimary ds-button--text ds-button--capsule ds-button--m ds-button--icon-relative-m" tabindex="0">
        <div class="ds-button__background"></div>
        <span class="ds-button__content">Forgot password?</span>
      </div>
      <div role="button" class="ds-button ds-button--textInheritedPrimary ds-button--text ds-button--capsule ds-button--m ds-button--icon-relative-m" tabindex="0">
        <div class="ds-button__background"></div>
        <span class="ds-button__content">Sign up</span>
      </div>
    </div>

    <!-- Кнопка Log in -->
    <div role="button" class="ds-button ds-button--primary ds-button--filled ds-button--capsule ds-button--xl ds-button--icon-relative-m ds-button--min-width" tabindex="0" style="--dsl-button-height: 42px;">
      <div class="ds-button__background"></div>
      <span class="ds-button__content">Log in</span>
    </div>

    <!-- Social buttons -->
    <div class="ds-sign-in-form__social-buttons">
      <div class="ds-sign-in-form__social-links">
        <div class="ds-sign-in-form__social-links-measurer">
          <span class="ds-sign-in-form__social-link-measure">Log in with Google</span>
          <span class="ds-sign-in-form__social-link-separator"></span>
          <span class="ds-sign-in-form__social-link-measure">Login with Apple</span>
        </div>
        <div role="button" class="ds-button ds-button--textLabelTertiary ds-button--text ds-button--capsule ds-button--m ds-button--icon-relative-m ds-button--underlined ds-sign-in-form__social-link" tabindex="0" style="text-underline-position: from-font;">
          <div class="ds-button__background"></div>
          <span class="ds-button__content">Log in with Google</span>
        </div>
        <span class="ds-sign-in-form__social-link-separator"></span>
        <div role="button" class="ds-button ds-button--textLabelTertiary ds-button--text ds-button--capsule ds-button--m ds-button--icon-relative-m ds-button--underlined ds-sign-in-form__social-link" tabindex="0" style="text-underline-position: from-font;">
          <div class="ds-button__background"></div>
          <span class="ds-button__content">Login with Apple</span>
        </div>
      </div>
    </div>
  </div>
</div>
```

---

## 1. Тогглы (DeepThink / Search)

### 1.1. DeepThink (активен)

```html
<div tabindex="0" aria-pressed="true" class="f79352dc ds-toggle-button ds-toggle-button--m ds-toggle-button--selected" style="transform: translateZ(0px);">
  <div class="ds-toggle-button__icon">
    <div class="ds-icon" style="font-size: inherit;">
      <svg>...</svg>
    </div>
  </div>
  <span class="_6dbc175">DeepThink</span>
  <div class="ds-focus-ring" style="--dsl-focus-ring-offset: -1px;"></div>
</div>
```

**Селектор:** `.ds-toggle-button:has-text("DeepThink")[aria-pressed="true"]`

---

### 1.2. DeepThink (неактивен)

```html
<div tabindex="0" aria-pressed="false" class="f79352dc ds-toggle-button ds-toggle-button--m" style="transform: translateZ(0px);">
  <div class="ds-toggle-button__icon">
    <div class="ds-icon" style="font-size: inherit;">
      <svg>...</svg>
    </div>
  </div>
  <span class="_6dbc175">DeepThink</span>
  <div class="ds-focus-ring" style="--dsl-focus-ring-offset: -1px;"></div>
</div>
```

**Селектор:** `.ds-toggle-button:has-text("DeepThink")`

---

### 1.3. Search (активен)

```html
<div tabindex="0" aria-pressed="true" class="f79352dc ds-toggle-button ds-toggle-button--m ds-toggle-button--selected" style="transform: translateZ(0px);">
  <div class="ds-toggle-button__icon">
    <div class="ds-icon" style="font-size: inherit;">
      <svg>...</svg>
    </div>
  </div>
  <span class="_6dbc175">Search</span>
  <div class="ds-focus-ring" style="--dsl-focus-ring-offset: -1px;"></div>
</div>
```

**Селектор:** `.ds-toggle-button:has-text("Search")[aria-pressed="true"]`

---

### 1.4. Search (неактивен)

```html
<div tabindex="0" aria-pressed="false" class="f79352dc ds-toggle-button ds-toggle-button--m" style="transform: translateZ(0px);">
  <div class="ds-toggle-button__icon">
    <div class="ds-icon" style="font-size: inherit;">
      <svg>...</svg>
    </div>
  </div>
  <span class="_6dbc175">Search</span>
  <div class="ds-focus-ring" style="--dsl-focus-ring-offset: -1px;"></div>
</div>
```

**Селектор:** `.ds-toggle-button:has-text("Search")`

---

## 2. Поле ввода и управление

### 2.1. Текстовое поле (с введённым текстом)

```html
<div class="_24fad49">
  <div class="ds-scroll-area__gutters" style="--container-height: 60px; position: absolute; inset: 0px; width: 100%;">
    <div class="ds-scroll-area__horizontal-gutter" style="left: 2px; right: 2px; display: block; bottom: 2px; height: 6px;">
      <div class="ds-scroll-area__horizontal-bar" style="display: none;"></div>
    </div>
    <div class="ds-scroll-area__vertical-gutter" style="right: 2px; top: 16px; bottom: 2px; width: 6px;">
      <div class="ds-scroll-area__vertical-bar" style="display: none;"></div>
    </div>
  </div>
  <textarea class="_27c9245 ds-scroll-area ds-scroll-area--show-on-focus-within ds-scroll-area--enabled d96f2d2a" placeholder="Message DeepSeek" rows="2" autocomplete="off" name="search" style="--container-height: 60px;">Some text</textarea>
  <div class="b13855df">Some text</div>
</div>
```

**Селектор:** `textarea[placeholder*="Message DeepSeek"]:not([role="searchbox"])`

---

### 2.2. Текстовое поле (пустое)

```html
<div class="_24fad49">
  <div class="ds-scroll-area__gutters" style="--container-height: 60px; position: absolute; inset: 0px; width: 100%;">
    <div class="ds-scroll-area__horizontal-gutter" style="left: 2px; right: 2px; display: block; bottom: 2px; height: 6px;">
      <div class="ds-scroll-area__horizontal-bar" style="display: none;"></div>
    </div>
    <div class="ds-scroll-area__vertical-gutter" style="right: 2px; top: 16px; bottom: 2px; width: 6px;">
      <div class="ds-scroll-area__vertical-bar" style="display: none;"></div>
    </div>
  </div>
  <textarea class="_27c9245 ds-scroll-area ds-scroll-area--show-on-focus-within ds-scroll-area--enabled d96f2d2a" placeholder="Message DeepSeek" rows="2" autocomplete="off" name="search" style="--container-height: 60px;"></textarea>
  <div class="b13855df"></div>
</div>
```

**Селектор:** `textarea[placeholder*="Message DeepSeek"]:not([role="searchbox"])`

---

### 2.3. Кнопка отправки (активна)

```html
<div style="width: fit-content;">
  <div role="button" class="ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--m ds-button--icon-relative-m _52c986b" style="--dsl-button-height: 34px;" tabindex="0">
    <div class="ds-button__background"></div>
    <div class="ds-button__icon ds-button__icon--last-child">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8.3125 0.981587C8.66767 1.0545 8.97902 1.20558 9.2627 1.43374C9.48724 1.61438 9.73029 1.85933 9.97949 2.10854L14.707 6.83608L13.293 8.25014L9 3.95717V15.0431H7V3.95717L2.70703 8.25014L1.29297 6.83608L6.02051 2.10854C6.26971 1.85933 6.51277 1.61438 6.7373 1.43374C6.97662 1.24126 7.28445 1.04542 7.6875 0.981587C7.8973 0.94841 8.1031 0.956564 8.3125 0.981587Z" fill="currentColor"></path>
      </svg>
    </div>
  </div>
</div>
```

**Селектор:** `[role="button"].ds-button--circle:has(svg path[d^="M8.3125 0.98"]):not(.ds-button--disabled)`

---

### 2.4. Кнопка отправки (неактивна)

```html
<div style="width: fit-content;">
  <div role="button" class="ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--m ds-button--icon-relative-m ds-button--disabled _52c986b bd74640a" style="--dsl-button-height: 34px;">
    <div class="ds-button__background"></div>
    <div class="ds-button__icon ds-button__icon--last-child">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8.3125 0.981587C8.66767 1.0545 8.97902 1.20558 9.2627 1.43374C9.48724 1.61438 9.73029 1.85933 9.97949 2.10854L14.707 6.83608L13.293 8.25014L9 3.95717V15.0431H7V3.95717L2.70703 8.25014L1.29297 6.83608L6.02051 2.10854C6.26971 1.85933 6.51277 1.61438 6.7373 1.43374C6.97662 1.24126 7.28445 1.04542 7.6875 0.981587C7.8973 0.94841 8.1031 0.956564 8.3125 0.981587Z" fill="currentColor"></path>
      </svg>
    </div>
  </div>
</div>
```

**Селектор:** `[role="button"].ds-button--circle:has(svg path[d^="M8.3125 0.98"])`

---

### 2.5. Кнопка загрузки файла (скрепка)

```html
<div role="button" class="ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--s ds-button--icon-relative-m f02f0e25" tabindex="0" style="--dsl-button-height: 34px;">
  <div class="ds-button__background"></div>
  <div class="ds-button__icon ds-button__icon--last-child">
    <div class="ds-icon" style="font-size: inherit;">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5.5498 9.75V5H6.9502V9.75C6.9502 10.3299 7.4201 10.7998 8 10.7998C8.5799 10.7998 9.0498 10.3299 9.0498 9.75V4.5C9.0498 2.9536 7.7964 1.7002 6.25 1.7002C4.7036 1.7002 3.4502 2.9536 3.4502 4.5V9.75C3.4502 12.2629 5.4871 14.2998 8 14.2998C10.5129 14.2998 12.5498 12.2629 12.5498 9.75V4H13.9502V9.75C13.9502 13.0361 11.2861 15.7002 8 15.7002C4.71391 15.7002 2.0498 13.0361 2.0498 9.75V4.5C2.04981 2.1804 3.9304 0.299806 6.25 0.299805C8.5696 0.299805 10.4502 2.1804 10.4502 4.5V9.75C10.4502 11.1031 9.3531 12.2002 8 12.2002C6.6469 12.2002 5.5498 11.1031 5.5498 9.75Z" fill="currentColor"></path>
      </svg>
    </div>
  </div>
</div>
```

**Селектор:** `[role="button"]:has(svg path[d^="M5.5498 9.75V5"])`

---

### 2.6. Плашка загруженного файла

```html
<div class="cd314545">
  <div class="_1c3b90b">
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" fill="none">
      <path d="M8.48924 28H19.5108C21.6479 28 22.7165 28 23.5594 27.6509C24.6833 27.1853 25.5762 26.2924 26.0417 25.1685C26.3909 24.3256 26.3909 23.257 26.3909 21.1199V8.79443C26.3909 8.32877 26.3909 8.09593 26.3471 7.87507C26.2887 7.58058 26.173 7.30042 26.0067 7.05048C25.882 6.86303 25.7177 6.69799 25.3893 6.36792L20.0611 1.01354C19.7304 0.681235 19.5651 0.515081 19.3769 0.38885C19.126 0.220541 18.8443 0.103463 18.5481 0.0443412C18.3259 0 18.0915 0 17.6226 0H8.48924C6.35209 0 5.28351 0 4.4406 0.349145C3.31672 0.814671 2.4238 1.70759 1.95828 2.83147C1.60913 3.67438 1.60913 4.74296 1.60913 6.88011V21.1199C1.60913 23.257 1.60913 24.3256 1.95828 25.1685C2.4238 26.2924 3.31672 27.1853 4.4406 27.6509C5.28351 28 6.35209 28 8.48924 28Z" fill="#418CFF"></path>
      <path d="M26.3909 7.37445L19.0525 0V3.77445C19.0525 4.89271 19.0525 5.45184 19.2352 5.89289C19.4788 6.48096 19.946 6.94818 20.5341 7.19176C20.9751 7.37445 21.5342 7.37445 22.6525 7.37445H26.3909Z" fill="white" fill-opacity=".7"></path>
      <path d="M8.10132 12.6846H19.8948" stroke="white" stroke-width="1.6"></path>
      <path d="M8.10132 16.4688H19.8948" stroke="white" stroke-width="1.6"></path>
      <path d="M8.10132 20.252H16.0199" stroke="white" stroke-width="1.6"></path>
    </svg>
  </div>
  <div class="_158cea4">
    <div class="_967f3f9">
      <div class="e70accd6">file_name.txt</div>
      <div class="d0fee470"></div>
    </div>
    <div class="_7103a25 _078ccb5">JS 80.53KB</div>
  </div>
  <div class="_8402d8c" tabindex="0">
    <div class="ds-icon" style="font-size: 14px; width: 14px; height: 14px;">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10.6074 4.40278L8.00975 6.99973L10.6074 9.59739L9.59736 10.6074L6.9997 8.00978L4.40274 10.6074L3.3927 9.59739L5.98966 6.99973L3.3927 4.40278L4.40274 3.39273L6.9997 5.98969L9.59736 3.39273L10.6074 4.40278Z" fill="currentColor"></path>
      </svg>
    </div>
    <div class="ds-focus-ring" style="--dsl-focus-ring-offset: -2px;"></div>
  </div>
</div>
```

**Селектор:** `div:has(svg path[d^="M10.6074 4.40278"])`

---

### 2.7. Кнопка удаления файла (крестик)

```html
<div class="_8402d8c" tabindex="0">
  <div class="ds-icon" style="font-size: 14px; width: 14px; height: 14px;">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10.6074 4.40278L8.00975 6.99973L10.6074 9.59739L9.59736 10.6074L6.9997 8.00978L4.40274 10.6074L3.3927 9.59739L5.98966 6.99973L3.3927 4.40278L4.40274 3.39273L6.9997 5.98969L9.59736 3.39273L10.6074 4.40278Z" fill="currentColor"></path>
    </svg>
  </div>
  <div class="ds-focus-ring" style="--dsl-focus-ring-offset: -2px;"></div>
</div>
```

**Селектор:** `svg path[d^="M10.6074 4.40278"]`

---

### 2.8. Кнопка Stop (во время генерации)

```html
<div style="width: fit-content;">
  <div role="button" class="ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--m ds-button--icon-relative-m _52c986b" style="--dsl-button-height: 34px;" tabindex="0">
    <div class="ds-button__background"></div>
    <div class="ds-button__icon ds-button__icon--last-child">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 4.88C2 3.68009 2 3.08013 2.30557 2.65954C2.40426 2.52371 2.52371 2.40426 2.65954 2.30557C3.08013 2 3.68009 2 4.88 2H11.12C12.3199 2 12.9199 2 13.3405 2.30557C13.4763 2.40426 13.5957 2.52371 13.6944 2.65954C14 3.08013 14 3.68009 14 4.88V11.12C14 12.3199 14 12.9199 13.6944 13.3405C13.5957 13.4763 13.4763 13.5957 13.3405 13.6944C12.9199 14 12.3199 14 11.12 14H4.88C3.68009 14 3.08013 14 2.65954 13.6944C2.52371 13.5957 2.40426 13.4763 2.30557 13.3405C2 12.9199 2 12.3199 2 11.12V4.88Z" fill="currentColor"></path>
      </svg>
    </div>
  </div>
</div>
```

**Селектор:** `[role="button"].ds-button--circle:has(svg path[d^="M2 4.88"])`

---

### 2.9. Кнопка Continue

```html
<div class="_8e85838">
  <div role="button" class="ds-button ds-button--outlinedNeutral ds-button--outlined ds-button--capsule ds-button--s ds-button--icon-relative-m ds-button--min-width _6eef0b0" tabindex="0">
    <div class="ds-button__background"></div>
    <div class="ds-button__border"></div>
    <span class="ds-button__content">Continue</span>
  </div>
</div>
```

**Селектор:** `[role="button"]:has-text("Continue")`

---

### 2.10. Кнопка "Scroll-to-bottom"

```html
<div role="button" class="ds-button ds-button--outlinedNeutral ds-button--outlined ds-button--circle ds-button--m ds-button--icon-relative-m ds-button--floating" tabindex="0" style="--dsl-button-color: var(--dsw-alias-button-floating-fill); --dsl-button-height: 34px; --dsl-button-color-hover: var(--dsw-alias-button-floating-hover); --dsl-button-icon-size: 14px;">
  <div class="ds-button__background"></div>
  <div class="ds-button__border"></div>
  <div class="ds-button__icon ds-button__icon--last-child">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z" fill="currentColor"></path>
    </svg>
  </div>
</div>
```

**Селектор:** `[role="button"].ds-button--floating:has(svg path[d^="M11.8486 5.5"])`

---

## 3. Кнопка копирования сообщения

```html
<div role="button" class="ds-button ds-button--borderlessNeutral ds-button--borderless ds-button--capsule ds-button--xs ds-button--icon-relative-m ds-button--min-width" tabindex="0" style="margin-right: 2px;">
  <div class="ds-button__background"></div>
  <div class="ds-button__icon">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6.14929 4.02032C7.11197 4.02032 7.87983 4.02016 8.49597 4.07598C9.12128 4.13269 9.65792 4.25188 10.1415 4.53106C10.7202 4.8653 11.2008 5.3459 11.535 5.92462C11.8142 6.40818 11.9334 6.94481 11.9901 7.57012C12.0459 8.18625 12.0458 8.95419 12.0458 9.9168C12.0458 10.8795 12.0459 11.6473 11.9901 12.2635C11.9334 12.8888 11.8142 13.4254 11.535 13.909C11.2008 14.4877 10.7202 14.9683 10.1415 15.3025C9.65792 15.5817 9.12128 15.7009 8.49597 15.7576C7.87984 15.8134 7.11196 15.8133 6.14929 15.8133C5.18667 15.8133 4.41874 15.8134 3.80261 15.7576C3.1773 15.7009 2.64067 15.5817 2.1571 15.3025C1.5784 14.9683 1.09778 14.4877 0.76355 13.909C0.484366 13.4254 0.365184 12.8888 0.308472 12.2635C0.252649 11.6473 0.252808 10.8795 0.252808 9.9168C0.252808 8.95418 0.252664 8.18625 0.308472 7.57012C0.365184 6.94481 0.484366 6.40818 0.76355 5.92462C1.09777 5.34589 1.57839 4.86529 2.1571 4.53106C2.64067 4.25188 3.1773 4.13269 3.80261 4.07598C4.41874 4.02017 5.18666 4.02032 6.14929 4.02032ZM6.14929 5.37774C5.16181 5.37774 4.46634 5.37761 3.92566 5.42657C3.39434 5.47472 3.07859 5.56574 2.83582 5.70587C2.4632 5.92106 2.15354 6.2307 1.93835 6.60333C1.79823 6.8461 1.70721 7.16185 1.65906 7.69317C1.6101 8.23385 1.61023 8.92933 1.61023 9.9168C1.61023 10.9043 1.61009 11.5998 1.65906 12.1404C1.70721 12.6717 1.79823 12.9875 1.93835 13.2303C2.15356 13.6029 2.46321 13.9126 2.83582 14.1277C3.07859 14.2679 3.39434 14.3589 3.92566 14.407C4.46634 14.456 5.16182 14.4559 6.14929 14.4559C7.13682 14.4559 7.83224 14.456 8.37292 14.407C8.90425 14.3589 9.21999 14.2679 9.46277 14.1277C9.83535 13.9126 10.145 13.6029 10.3602 13.2303C10.5004 12.9875 10.5914 12.6717 10.6395 12.1404C10.6885 11.5998 10.6884 10.9043 10.6884 9.9168C10.6884 8.92934 10.6885 8.23384 10.6395 7.69317C10.5914 7.16185 10.5004 6.8461 10.3602 6.60333C10.1451 6.23071 9.83536 5.92107 9.46277 5.70587C9.21999 5.56574 8.90424 5.47472 8.37292 5.42657C7.83224 5.3776 7.13682 5.37774 6.14929 5.37774ZM9.80164 0.367975C10.7638 0.367975 11.5314 0.36788 12.1473 0.423639C12.7726 0.480307 13.3093 0.598759 13.7928 0.877741C14.3717 1.21192 14.8521 1.69355 15.1864 2.27227C15.4655 2.75574 15.5857 3.29164 15.6425 3.9168C15.6983 4.53301 15.6971 5.3016 15.6971 6.26446V7.82989C15.6971 8.29264 15.6989 8.58993 15.6649 8.84844C15.4668 10.3525 14.401 11.5738 12.9833 11.9988V10.5467C13.6973 10.1903 14.2105 9.49662 14.3192 8.67169C14.3387 8.52347 14.3407 8.3358 14.3407 7.82989V6.26446C14.3407 5.27706 14.3398 4.58149 14.2909 4.04083C14.2428 3.50968 14.1526 3.19372 14.0126 2.95098C13.7974 2.57849 13.4876 2.26869 13.1151 2.05352C12.8724 1.91347 12.5564 1.82237 12.0253 1.77423C11.4847 1.72528 10.7888 1.7254 9.80164 1.7254H7.71472C6.7562 1.72558 5.92665 2.27697 5.52332 3.07891H4.07019C4.54221 1.51132 5.9932 0.368186 7.71472 0.367975H9.80164Z" fill="currentColor"></path>
    </svg>
  </div>
  <span class="ds-button__content">
    <span class="code-info-button-text">Copy</span>
  </span>
</div>
```

**Селектор:** используется контекст `data-virtual-list-item-key` (см. B3)

---

## 4. Сайдбар и навигация

### 4.1. Кнопка New chat (развёрнутый сайдбар)

```html
<div class="_5a8ac7a" tabindex="0" style="justify-content: center;">
  <div class="ds-icon _1c42ad7" style="font-size: 16px; width: 16px; height: 16px;">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 0.599609C3.91309 0.599609 0.599609 3.91309 0.599609 8C0.599609 9.13376 0.855461 10.2098 1.3125 11.1719L1.5918 11.7588L2.76562 11.2012L2.48633 10.6143C2.11034 9.82278 1.90039 8.93675 1.90039 8C1.90039 4.63106 4.63106 1.90039 8 1.90039C11.3689 1.90039 14.0996 4.63106 14.0996 8C14.0996 11.3689 11.3689 14.0996 8 14.0996C7.31041 14.0996 6.80528 14.0514 6.35742 13.9277C5.91623 13.8059 5.49768 13.6021 4.99707 13.2529C4.26492 12.7422 3.21611 12.5616 2.35156 13.1074L2.33789 13.1162L2.32422 13.126L1.58789 13.6436L2.01953 14.9297L3.0459 14.207C3.36351 14.0065 3.83838 14.0294 4.25293 14.3184C4.84547 14.7317 5.39743 15.011 6.01172 15.1807C6.61947 15.3485 7.25549 15.4004 8 15.4004C12.0869 15.4004 15.4004 12.0869 15.4004 8C15.4004 3.91309 12.0869 0.599609 8 0.599609ZM7.34473 4.93945V7.34961H4.93945V8.65039H7.34473V11.0605H8.64551V8.65039H11.0605V7.34961H8.64551V4.93945H7.34473Z" fill="currentColor"></path>
    </svg>
  </div>
  <span>New chat</span>
  <div class="ds-focus-ring"></div>
</div>
```

**Селектор:** `getByText('New chat')`

---

### 4.2. Кнопка New chat (свёрнутый сайдбар)

```html
<div role="button" class="ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--m ds-button--icon-relative-m _4f3769f" tabindex="0" style="--dsl-button-height: 34px;">
  <div class="ds-button__background"></div>
  <div class="ds-button__icon ds-button__icon--last-child">
    <div class="ds-icon" style="font-size: inherit;">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 0.599609C3.91309 0.599609 0.599609 3.91309 0.599609 8C0.599609 9.13376 0.855461 10.2098 1.3125 11.1719L1.5918 11.7588L2.76562 11.2012L2.48633 10.6143C2.11034 9.82278 1.90039 8.93675 1.90039 8C1.90039 4.63106 4.63106 1.90039 8 1.90039C11.3689 1.90039 14.0996 4.63106 14.0996 8C14.0996 11.3689 11.3689 14.0996 8 14.0996C7.31041 14.0996 6.80528 14.0514 6.35742 13.9277C5.91623 13.8059 5.49768 13.6021 4.99707 13.2529C4.26492 12.7422 3.21611 12.5616 2.35156 13.1074L2.33789 13.1162L2.32422 13.126L1.58789 13.6436L2.01953 14.9297L3.0459 14.207C3.36351 14.0065 3.83838 14.0294 4.25293 14.3184C4.84547 14.7317 5.39743 15.011 6.01172 15.1807C6.61947 15.3485 7.25549 15.4004 8 15.4004C12.0869 15.4004 15.4004 12.0869 15.4004 8C15.4004 3.91309 12.0869 0.599609 8 0.599609ZM7.34473 4.93945V7.34961H4.93945V8.65039H7.34473V11.0605H8.64551V8.65039H11.0605V7.34961H8.64551V4.93945H7.34473Z" fill="currentColor"></path>
      </svg>
    </div>
  </div>
</div>
```

**Селектор:** `[role="button"]:has(svg path[d^="M8 0.599609"])`

---

### 4.3. Кнопка сворачивания/разворачивания сайдбара

```html
<div role="button" class="ds-button ds-button--iconLabelTertiary ds-button--icon ds-button--capsule ds-button--m ds-button--icon-relative-m ds-button--sizing-content d05a0287" tabindex="0" style="--dsl-button-height: 34px;">
  <div class="ds-button__background"></div>
  <div class="ds-button__icon ds-button__icon--last-child">
    <div class="ds-icon" style="font-size: inherit;">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M9.67272 0.522841C10.8339 0.522841 11.76 0.522714 12.4963 0.602493C13.2453 0.683657 13.8789 0.854248 14.4264 1.25197C14.7504 1.48739 15.0355 1.77247 15.2709 2.0965C15.6686 2.64394 15.8392 3.27758 15.9204 4.02655C16.0002 4.7629 16 5.68895 16 6.85014V9.14986C16 10.3111 16.0002 11.2371 15.9204 11.9735C15.8392 12.7224 15.6686 13.3561 15.2709 13.9035C15.0355 14.2275 14.7504 14.5126 14.4264 14.748C13.8789 15.1458 13.2453 15.3163 12.4963 15.3975C11.76 15.4773 10.8339 15.4772 9.67272 15.4772H6.3273C5.16611 15.4772 4.24006 15.4773 3.50371 15.3975C2.75474 15.3163 2.1211 15.1458 1.57366 14.748C1.24963 14.5126 0.964549 14.2275 0.729131 13.9035C0.331407 13.3561 0.160817 12.7224 0.0796529 11.9735C-0.000126137 11.2371 1.25338e-09 10.3111 1.25338e-09 9.14986V6.85014C1.25329e-09 5.68895 -0.000126137 4.7629 0.0796529 4.02655C0.160817 3.27758 0.331407 2.64394 0.729131 2.0965C0.964549 1.77247 1.24963 1.48739 1.57366 1.25197C2.1211 0.854248 2.75474 0.683657 3.50371 0.602493C4.24006 0.522714 5.16611 0.522841 6.3273 0.522841H9.67272ZM5.54303 1.88715V14.1118C5.78636 14.1128 6.04709 14.1169 6.3273 14.1169H9.67272C10.8639 14.1169 11.7032 14.1164 12.3493 14.0465C12.9824 13.9779 13.3497 13.8494 13.6268 13.6482C13.8354 13.4966 14.0195 13.3125 14.1711 13.1039C14.3723 12.8268 14.5007 12.4595 14.5693 11.8264C14.6393 11.1803 14.6398 10.341 14.6398 9.14986V6.85014C14.6398 5.65896 14.6393 4.81967 14.5693 4.1736C14.5007 3.54048 14.3723 3.17318 14.1711 2.89609C14.0195 2.68747 13.8354 2.50337 13.6268 2.35179C13.3497 2.1506 12.9824 2.02212 12.3493 1.95353C11.7032 1.88358 10.8639 1.88307 9.67272 1.88307H6.3273C6.04709 1.88307 5.78636 1.8862 5.54303 1.88715ZM4.1828 1.91166C3.99125 1.9216 3.8148 1.93577 3.65076 1.95353C3.01764 2.02212 2.65034 2.1506 2.37325 2.35179C2.16463 2.50337 1.98052 2.68747 1.82895 2.89609C1.62776 3.17318 1.49928 3.54048 1.43069 4.1736C1.36074 4.81967 1.36023 5.65896 1.36023 6.85014V9.14986C1.36023 10.341 1.36074 11.1803 1.43069 11.8264C1.49928 12.4595 1.62776 12.8268 1.82895 13.1039C1.98052 13.3125 2.16463 13.4966 2.37325 13.6482C2.65034 13.8494 3.01764 13.9779 3.65076 14.0465C3.81478 14.0642 3.99127 14.0774 4.1828 14.0873V1.91166Z" fill="currentColor"></path>
      </svg>
    </div>
  </div>
</div>
```

**Селектор:** `[role="button"]:has(svg path[d^="M9.67272 0.522841"])`

---

### 4.4. Плашка профиля

```html
<div class="_7b40dad f14f3a6d">
  <div class="dc1f7bee _4bcc731">
    <div class="_2afd28d" tabindex="0">
      <div class="ede5bc47">
        <img class="fdf01f38" src="https://static.deepseek.com/user-avatar/2GmU7BHgai2nnQc6nDcE9JVm" alt="" aria-hidden="true" style="display: block;">
      </div>
      <div class="_9d8da05">User Name</div>
      <div class="ds-icon _39cc453" style="font-size: 16px; width: 16px; height: 16px;">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4.55146 8.00001C4.55146 8.63513 4.03659 9.15001 3.40146 9.15001C2.76634 9.15001 2.25146 8.63513 2.25146 8.00001C2.25146 7.36488 2.76634 6.85001 3.40146 6.85001C4.03659 6.85001 4.55146 7.36488 4.55146 8.00001Z" fill="currentColor"></path>
          <path d="M9.1476 8.00001C9.1476 8.63513 8.63273 9.15001 7.9976 9.15001C7.36248 9.15001 6.8476 8.63513 6.8476 8.00001C6.8476 7.36488 7.36248 6.85001 7.9976 6.85001C8.63273 6.85001 9.1476 7.36488 9.1476 8.00001Z" fill="currentColor"></path>
          <path d="M13.7486 8.00001C13.7486 8.63513 13.2338 9.15001 12.5986 9.15001C11.9635 9.15001 11.4486 8.63513 11.4486 8.00001C11.4486 7.36488 11.9635 6.85001 12.5986 6.85001C13.2338 6.85001 13.7486 7.36488 13.7486 8.00001Z" fill="currentColor"></path>
        </svg>
      </div>
      <div class="ds-focus-ring"></div>
    </div>
  </div>
</div>
```

**Селектор:** `page.evaluate()` по иконке `M4.55146 8.00001`

---

### 4.5. Контекстное меню чата (три точки)

```html
<a class="_546d736 b64fb9ae" href="/a/chat/s/722d31ad-2c7e-4f60-8f54-d3cc2d7615f5" tabindex="0">
  <div class="ds-focus-ring"></div>
  <div class="c08e6e93">Название чата</div>
  <div class="_254829d">
    <div role="button" class="ds-button ds-button--iconLabelTertiary ds-button--icon ds-button--capsule ds-button--xs ds-button--icon-relative-l _2090548" tabindex="0">
      <div class="ds-button__background"></div>
      <div class="ds-button__icon ds-button__icon--last-child">
        <div class="ds-icon" style="font-size: inherit;">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4.55146 8.00001C4.55146 8.63513 4.03659 9.15001 3.40146 9.15001C2.76634 9.15001 2.25146 8.63513 2.25146 8.00001C2.25146 7.36488 2.76634 6.85001 3.40146 6.85001C4.03659 6.85001 4.55146 7.36488 4.55146 8.00001Z" fill="currentColor"></path>
            <path d="M9.1476 8.00001C9.1476 8.63513 8.63273 9.15001 7.9976 9.15001C7.36248 9.15001 6.8476 8.63513 6.8476 8.00001C6.8476 7.36488 7.36248 6.85001 7.9976 6.85001C8.63273 6.85001 9.1476 7.36488 9.1476 8.00001Z" fill="currentColor"></path>
            <path d="M13.7486 8.00001C13.7486 8.63513 13.2338 9.15001 12.5986 9.15001C11.9635 9.15001 11.4486 8.63513 11.4486 8.00001C11.4486 7.36488 11.9635 6.85001 12.5986 6.85001C13.2338 6.85001 13.7486 7.36488 13.7486 8.00001Z" fill="currentColor"></path>
          </svg>
        </div>
      </div>
    </div>
  </div>
</a>
```

**Селектор:** `a[href^="/a/chat/s/"] [role="button"]:has(svg path[d^="M4.55146 8.00001"])`

---

### 4.6. Пункты контекстного меню

```html
<!-- Rename -->
<div class="ds-dropdown-menu-option ds-dropdown-menu-option--none">
  <div class="ds-dropdown-menu-option__icon">
    <svg>...</svg>
  </div>
  <div class="ds-dropdown-menu-option__label">Rename</div>
</div>

<!-- Pin -->
<div class="ds-dropdown-menu-option ds-dropdown-menu-option--none">
  <div class="ds-dropdown-menu-option__icon">
    <svg>...</svg>
  </div>
  <div class="ds-dropdown-menu-option__label">Pin</div>
</div>

<!-- Share -->
<div class="ds-dropdown-menu-option ds-dropdown-menu-option--none">
  <div class="ds-dropdown-menu-option__icon">
    <svg>...</svg>
  </div>
  <div class="ds-dropdown-menu-option__label">Share</div>
</div>

<!-- Delete -->
<div class="ds-dropdown-menu-option ds-dropdown-menu-option--error">
  <div class="ds-dropdown-menu-option__icon">
    <svg>...</svg>
  </div>
  <div class="ds-dropdown-menu-option__label">Delete</div>
</div>
```

**Селекторы:**
- Rename: `.ds-dropdown-menu-option:has(.ds-dropdown-menu-option__label:has-text("Rename"))`
- Pin: `.ds-dropdown-menu-option:has(.ds-dropdown-menu-option__label:has-text("Pin"))`
- Share: `.ds-dropdown-menu-option:has(.ds-dropdown-menu-option__label:has-text("Share"))`
- Delete: `.ds-dropdown-menu-option:has(.ds-dropdown-menu-option__label:has-text("Delete"))`

---

### 4.7. Диалог подтверждения удаления

```html
<div class="ds-modal-content__footer">
  <div class="ds-modal-content__button-group">
    <div role="button" class="ds-button ds-button--outlinedNeutral ds-button--outlined ds-button--capsule ds-button--m ds-button--icon-relative-m ds-button--min-width" tabindex="0">
      <div class="ds-button__background"></div>
      <div class="ds-button__border"></div>
      <span class="ds-button__content">Cancel</span>
    </div>
    <div role="button" class="ds-button ds-button--error ds-button--filled ds-button--capsule ds-button--m ds-button--icon-relative-m ds-button--min-width _0efab74" tabindex="0">
      <div class="ds-button__background"></div>
      <span class="ds-button__content">Delete chat</span>
    </div>
  </div>
</div>
```

**Селекторы:**
- Cancel: `button:has-text("Cancel")`
- Delete chat: `.ds-button--error:has-text("Delete chat")`

---

## 5. Настройки (Settings)

### 5.1. Пункт Settings в меню профиля

```html
<div class="ds-dropdown-menu-option ds-dropdown-menu-option--none">
  <div class="ds-dropdown-menu-option__icon">
    <svg>...</svg>
  </div>
  <div class="ds-dropdown-menu-option__label">Settings</div>
</div>
```

**Селектор:** `.ds-dropdown-menu-option:has(.ds-dropdown-menu-option__label:has-text("Settings"))`

---

### 5.2. Вкладки настроек

```html
<!-- General -->
<div role="button" class="ds-button ds-button--outlinedNeutral ds-button--borderless ds-button--capsule ds-button--m ds-button--icon-relative-m ds-button--min-width _266abb8 _699d482" tabindex="0">
  <span class="ds-button__content">General</span>
</div>

<!-- Profile -->
<div role="button" class="ds-button ds-button--outlinedNeutral ds-button--borderless ds-button--capsule ds-button--m ds-button--icon-relative-m ds-button--min-width _266abb8" tabindex="0">
  <span class="ds-button__content">Profile</span>
</div>

<!-- Data -->
<div role="button" class="ds-button ds-button--outlinedNeutral ds-button--borderless ds-button--capsule ds-button--m ds-button--icon-relative-m ds-button--min-width _266abb8" tabindex="0">
  <span class="ds-button__content">Data</span>
</div>

<!-- About -->
<div role="button" class="ds-button ds-button--outlinedNeutral ds-button--borderless ds-button--capsule ds-button--m ds-button--icon-relative-m ds-button--min-width _266abb8" tabindex="0">
  <span class="ds-button__content">About</span>
</div>
```

**Селекторы:**
- General: `[role="button"]:has-text("General")`
- Profile: `[role="button"]:has-text("Profile")`
- Data: `[role="button"]:has-text("Data")`
- About: `[role="button"]:has-text("About")`

---

### 5.3. Выбор языка

```html
<div class="ds-flex _50b3d9e" style="padding: 12px 0px; min-height: 60px; box-sizing: border-box; justify-content: space-between; align-items: center; gap: 12px;">
  Language
  <div class="e311289c ds-select ds-select--filled ds-select--none ds-select--m" tabindex="0">
    <div class="ds-select__select">English</div>
    <div class="ds-select__arrow" aria-hidden="true">
      <svg>...</svg>
    </div>
  </div>
</div>
```

**Селекторы:**
- Language select: `.ds-select`
- English option: `.ds-select-option:has(span:has-text("English")):not(:has(span:has-text("(")))`

---

### 5.4. Кнопка View (Privacy Policy)

```html
<div class="ds-flex _50b3d9e" style="padding: 12px 0px; min-height: 60px; box-sizing: border-box; justify-content: space-between; align-items: center; gap: 12px;">
  Privacy Policy
  <a target="_blank" rel="noopener noreferrer" href="https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html?locale=en_US" role="button" class="ds-button ds-button--outlinedNeutral ds-button--outlined ds-button--capsule ds-button--m ds-button--icon-relative-m ds-button--min-width" tabindex="0">
    <span class="ds-button__content">View</span>
  </a>
</div>
```

**Селектор:** `a[href*="privacy-policy"]:has-text("View")`

---

### 5.5. Закрытие настроек (крестик)

```html
<div role="button" class="ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--xs ds-button--icon-relative-m ds-button--sizing-content ds-modal-content__close" tabindex="0">
  <div class="ds-button__background"></div>
  <div class="ds-button__icon ds-button__icon--last-child">
    <div class="ds-icon" style="font-size: inherit;">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14.1871 13.1265L13.1265 14.1872L1.81275 2.87347L2.87341 1.81281L14.1871 13.1265Z" fill="currentColor"></path>
        <path d="M13.1265 1.81282L14.1871 2.87348L2.8734 14.1872L1.81274 13.1265L13.1265 1.81282Z" fill="currentColor"></path>
      </svg>
    </div>
  </div>
</div>
```

**Селектор:** `.ds-modal-content__close`

---

## 6. Плашка Server Busy

**Где появляется:** в ленте сообщений вместо ответа ассистента,
когда бэкенд DeepSeek отказывает.

**Селекторы детекта (см. `src/browser/Selectors.ts`):**

| Признак | Значение | Приоритет |
|---|---|---|
| Retry-иконка | `svg path[d^="M9.94076 1.34942"]` | основной |
| Текст предупреждения | `Server busy, please try again later.` | резервный |

**Что нужно захватить:** весь блок `[data-virtual-list-item-key]`,
содержащий плашку. Обратить внимание:
- Роль блока (`user` / `assistant` / `system`).
- Точное расположение SVG Retry внутри блока.
- Точный `<span>` с текстом предупреждения.
- Есть ли рядом другие служебные элементы.

```html
<!-- ЗАПОЛНИТЬ: сырой HTML блока Server Busy -->
```

---

## 7. Футер ассистентского сообщения (Continue + Regenerate + Copy)

**Где появляется:** под каждым ответом ассистента. Содержит кнопки
действий; часть из них видна только при наведении.

**Селекторы (см. `src/browser/Selectors.ts`):**

| Кнопка | Признак |
|---|---|
| Continue | `[role="button"]:has-text("Continue")` (текст) |
| Regenerate | `svg path[d^="M7.92136 0.349152"]` (префикс) |
| Copy | `svg path[d^="M6.14929 4.02032"]` (префикс) |
| Download | `svg path[d^="M15.3695 11.411"]` (префикс) |

**Что нужно захватить:** весь footer-блок под ответом, включая:
- Общую обёртку, содержащую Continue / Regenerate / Copy.
- **Важно:** зафиксировать взаимное расположение Copy и Regenerate
  в DOM (они должны быть в одном родителе — это используется в
  алгоритме B3 для отличия Copy-ответа от Copy-кода).
- Разницу между футером сообщения и футером блока кода
  (в блоке кода есть свой Copy, но нет Regenerate).

```html
<!-- ЗАПОЛНИТЬ: сырой HTML футера ассистентского сообщения -->
```

**Сравнение с блоком кода** (для контраста):

```html
<!-- ЗАПОЛНИТЬ: сырой HTML футера блока кода внутри ответа -->
```

---

## 8. Баннер Length Limit

**Где появляется:** в ленте сообщений, как отдельный служебный блок
(не внутри сообщения пользователя или ассистента), когда DeepSeek
сообщает о достижении лимита контекста.

**Селектор:** регулярное выражение `Selectors.lengthLimitBannerPattern`:
```
/Length limit reached[^\n]*/i
```

**Наблюдаемые формулировки:**
- `Length limit reached. Please start a new chat.` (без процентов)
- `Length limit reached. DeepSeek can only read the first 75%...` (с процентами)

**Что нужно захватить:** весь блок-обёртка баннера. Обратить внимание:
- Есть ли у блока `data-virtual-list-item-key`.
- В каком `<span>` / `<div>` лежит текст.
- Как выглядит вторая формулировка (с процентами).

```html
<!-- ЗАПОЛНИТЬ: сырой HTML баннера Length Limit (без процентов) -->
```

```html
<!-- ЗАПОЛНИТЬ: сырой HTML баннера Length Limit (с процентами) -->
```

---

## Примечания

- Все хэшированные классы (например, `_9f2341b`, `c03d486a`, `_46a12ab`) приведены только для контекста. В селекторах они **не используются**.
- Для страницы входа используются селекторы без текста, чтобы не зависеть от языка интерфейса.
- Актуальные селекторы для каждого элемента приведены в [каталоге селекторов](../selectors/catalog.md) и в `src/browser/Selectors.ts`.
- Разделы 6–8 добавлены 2026-09-18. Если UI изменится и формулировки/пути поменяются, обновить здесь и в `Selectors.ts` одновременно. Проверять через `npm run test:selectors`.


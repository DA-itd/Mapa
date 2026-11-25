# Especificación de Seguridad Firestore — Mapa Campus ITD

## Invariantes de Datos (Phase 0)

1. Ningún documento en `/campusBuildings` o `/campusSpaces` puede ser creado, modificado o eliminado sin un usuario autenticado con Google (`request.auth != null`) y correo verificado (`request.auth.token.email_verified == true`).
2. Ningún espacio interior (`/campusSpaces/{spaceId}`) puede existir de forma huérfana: `buildingId` debe referenciar un documento existente en `/campusBuildings/{buildingId}` mediante `exists()`.
3. Las marcas de tiempo `createdAt` y `updatedAt` deben coincidir estrictamente con `request.time`.
4. Los campos inmutables (`id`, `createdByUid`, `createdAt`, y `buildingId` en espacios) no pueden alterarse tras la creación.
5. Las listas abiertas están prohibidas; `matchKeywords` está acotado a máximo 15 elementos y toda cadena tiene un límite explícito `.size()`.
6. Todas las consultas `allow list` evalúan explícitamente `resource.data.visibility == 'public'` (sin delegar filtrado al cliente ni usar `get()`/`exists()` dentro de `allow list`).
7. Ningún campo de PII (correo electrónico o teléfono) se almacena en las colecciones públicas del campus.

## Payloads Adversarios ("Dirty Dozen")

1. **Unauthenticated Create (`campusBuildings`)**: `request.auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Create (`campusBuildings`)**: `email_verified == false` -> `PERMISSION_DENIED`.
3. **UID Spoofing (`campusBuildings`)**: `createdByUid != request.auth.uid` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection (`campusBuildings`)**: incluir propiedad extra `isOfficialAdmin: true` -> bloqueado por `keys().hasOnly(...)` -> `PERMISSION_DENIED`.
5. **Oversized ID Poisoning**: `buildingId` de 300 caracteres o con `/` -> bloqueado por `isValidId()` -> `PERMISSION_DENIED`.
6. **Client Timestamp Forgery**: `createdAt` distinto de `request.time` -> `PERMISSION_DENIED`.
7. **Orphan Space Create (`campusSpaces`)**: `buildingId` inexistente en `/campusBuildings` -> bloqueado por `exists()` -> `PERMISSION_DENIED`.
8. **Invalid Category / Kind Enum**: `kind: "Otro"` o `category: "Fake"` -> `PERMISSION_DENIED`.
9. **Unbounded Array Bomb (`matchKeywords`)**: 50 elementos en `matchKeywords` -> bloqueado por `size() <= 15` -> `PERMISSION_DENIED`.
10. **Out-of-range GPS (`customLatLng`)**: `{ lat: 199, lng: 0 }` -> `PERMISSION_DENIED`.
11. **Immutable Owner Rewrite**: intentar cambiar `createdByUid` en `update` -> `PERMISSION_DENIED`.
12. **Unauthorized Space Deletion**: brigadista A intenta borrar espacio de brigadista B sin ser coordinador admin -> `PERMISSION_DENIED`.

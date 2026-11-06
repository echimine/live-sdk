package fr.echimine.live.ui

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import fr.echimine.live.core.Live
import fr.echimine.live.core.LiveConfig
import fr.echimine.live.core.LiveResult
import fr.echimine.live.core.Product
import fr.echimine.live.core.ProductImage
import fr.echimine.live.core.productProblem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Animateur : épingle un produit, le change ou le retire. Avec une [ProductSource], une recherche
 * dans le catalogue de l'App membre préremplit le formulaire ; la saisie manuelle reste toujours possible.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PinProductSheet(
    live: Live,
    config: LiveConfig,
    pinned: Product?,
    productSource: ProductSource?,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by rememberSaveable { mutableStateOf("") }
    var price by rememberSaveable { mutableStateOf("") }
    var currency by rememberSaveable { mutableStateOf(pinned?.currency ?: localCurrency()) }
    /** Image distante (catalogue), transmise telle quelle. */
    var imageUrl by rememberSaveable { mutableStateOf<String?>(null) }
    /** Photo prise ou choisie, envoyée au serveur commun. */
    var photo by rememberSaveable { mutableStateOf<Uri?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            photo = uri
            imageUrl = null
        }
    }
    var pendingCapture by rememberSaveable { mutableStateOf<Uri?>(null) }
    val takePhoto = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        if (saved) {
            photo = pendingCapture
            imageUrl = null
        }
    }

    val cents = parsePrice(price)
    val problem = when {
        name.isBlank() && price.isBlank() -> null
        cents == null -> "Prix illisible."
        else -> productProblem(name.trim(), cents, currency.trim(), imageUrl.takeIf { photo == null }, config.productNameMaxLength)
    }
    val canPin = !busy && name.isNotBlank() && cents != null && problem == null

    fun pin() {
        if (!canPin || cents == null) return
        busy = true
        error = null
        scope.launch {
            val image = photo?.let { uri ->
                val bytes = withContext(Dispatchers.IO) { readBytes(context, uri) }
                if (bytes == null) {
                    error = "Photo illisible."
                    busy = false
                    return@launch
                }
                ProductImage.Data(bytes)
            } ?: imageUrl?.let { ProductImage.Url(it) }
            when (val result = live.pinProduct(name, cents, currency.trim(), image)) {
                is LiveResult.Success -> onDismiss()
                is LiveResult.Failure -> error = result.error.displayMessage()
            }
            busy = false
        }
    }

    fun unpin() {
        busy = true
        error = null
        scope.launch {
            when (val result = live.unpinProduct()) {
                is LiveResult.Success -> onDismiss()
                is LiveResult.Failure -> error = result.error.displayMessage()
            }
            busy = false
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(if (pinned == null) "Épingler un produit" else "Changer le produit", style = MaterialTheme.typography.titleMedium)
            if (pinned != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ProductThumbnail(pinned.imageUrl, Modifier.size(40.dp))
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(pinned.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(formatPrice(pinned.price, pinned.currency), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    TextButton(onClick = ::unpin, enabled = !busy) { Text("Retirer") }
                }
                HorizontalDivider()
            }
            if (productSource != null) {
                CatalogSearch(productSource, config) { suggestion ->
                    name = suggestion.name
                    currency = suggestion.currency
                    price = editablePrice(suggestion.priceCents)
                    imageUrl = suggestion.imageUrl
                    photo = null
                    error = null
                }
                HorizontalDivider()
            }
            val shape = RoundedCornerShape(LocalLiveTheme.current.cornerRadius)
            OutlinedTextField(
                value = name,
                onValueChange = { name = it; error = null },
                label = { Text("Nom") },
                singleLine = true,
                shape = shape,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = price,
                    onValueChange = { price = it; error = null },
                    label = { Text("Prix") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    shape = shape,
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = currency,
                    onValueChange = { currency = it.uppercase().take(3); error = null },
                    label = { Text("Devise") },
                    singleLine = true,
                    shape = shape,
                    modifier = Modifier.width(110.dp),
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val preview: Any? = photo ?: imageUrl
                if (preview != null) {
                    Box(Modifier.size(56.dp).clip(shape).background(MaterialTheme.colorScheme.surfaceVariant)) {
                        AsyncImage(preview, contentDescription = "Photo du produit", contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
                    }
                }
                OutlinedButton(onClick = {
                    pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }) { Text("Choisir") }
                OutlinedButton(onClick = {
                    val uri = captureUri(context)
                    pendingCapture = uri
                    runCatching { takePhoto.launch(uri) }.onFailure { error = "Appareil photo indisponible." }
                }) { Text("Prendre") }
                if (preview != null) {
                    TextButton(onClick = { photo = null; imageUrl = null }) { Text("Sans photo") }
                }
            }
            (error ?: problem)?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp) }
            Button(onClick = ::pin, enabled = canPin, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                if (busy) InlineProgress() else Text(if (pinned == null) "Épingler" else "Remplacer le produit")
            }
        }
    }
}

/** Recherche dans le catalogue de l'App membre ; un résultat préremplit le formulaire. */
@Composable
private fun CatalogSearch(source: ProductSource, config: LiveConfig, onPick: (ProductSuggestion) -> Unit) {
    val scope = rememberCoroutineScope()
    val latestConfig by rememberUpdatedState(config)
    val search = remember(source) { ProductSearch(source, scope) { latestConfig.productNameMaxLength } }
    val state by search.state.collectAsStateWithLifecycle()
    var query by rememberSaveable { mutableStateOf("") }
    // Après une rotation, la recherche est recréée : relancer la requête restée dans le champ.
    LaunchedEffect(search) { if (query.isNotBlank()) search.retry(query) }

    OutlinedTextField(
        value = query,
        onValueChange = {
            query = it
            search.onQueryChange(it)
        },
        label = { Text("Rechercher dans le catalogue") },
        singleLine = true,
        shape = RoundedCornerShape(LocalLiveTheme.current.cornerRadius),
        modifier = Modifier.fillMaxWidth(),
    )
    when (val current = state) {
        ProductSearchState.Idle -> Unit
        ProductSearchState.Loading -> Row(verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Recherche…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        ProductSearchState.Unavailable -> Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Catalogue indisponible", fontWeight = FontWeight.SemiBold)
                Text("Vous pouvez saisir le produit à la main.", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            }
            TextButton(onClick = { search.retry() }) { Text("Réessayer") }
        }
        is ProductSearchState.Results -> if (current.suggestions.isEmpty()) {
            Text("Aucun produit trouvé.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Column(Modifier.heightIn(max = 280.dp).verticalScroll(rememberScrollState())) {
                current.suggestions.forEach { suggestion ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(LocalLiveTheme.current.cornerRadius))
                            .clickable(onClickLabel = "Préremplir") { onPick(suggestion) }
                            .padding(vertical = 6.dp, horizontal = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        ProductThumbnail(suggestion.imageUrl, Modifier.size(40.dp))
                        Spacer(Modifier.width(10.dp))
                        Text(suggestion.name, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(formatPrice(suggestion.priceCents, suggestion.currency), fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

/** Fichier temporaire où l'appareil photo enregistre sa prise. */
private fun captureUri(context: Context): Uri {
    val dir = File(context.cacheDir, "live-sdk").apply { mkdirs() }
    // Un fichier par prise : une URI réutilisée afficherait l'ancienne photo, mise en cache.
    dir.listFiles()?.forEach { it.delete() }
    val file = File(dir, "produit-${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.livesdk.fileprovider", file)
}

private fun readBytes(context: Context, uri: Uri): ByteArray? =
    runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()

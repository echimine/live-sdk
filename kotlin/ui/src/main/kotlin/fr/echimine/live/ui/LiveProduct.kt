package fr.echimine.live.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import fr.echimine.live.core.Live
import fr.echimine.live.core.LiveErrorCode
import fr.echimine.live.core.LiveResult
import fr.echimine.live.core.Product
import kotlinx.coroutines.launch

/*
 * Le Produit épinglé côté Spectateur : sa pastille sur la vidéo et sa fiche avec « Confirmer l'achat ».
 * L'épinglage par l'Animateur est dans `PinProductSheet.kt`, le formatage des prix dans `Price.kt`.
 */

// ------------------------------------------------------------------ pastille

/** La pastille du Produit épinglé, sur la vidéo ; un tap ouvre sa fiche. */
@Composable
internal fun PinnedProductPill(product: Product, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val radius = LocalLiveTheme.current.cornerRadius
    Row(
        modifier
            .widthIn(max = 260.dp)
            .clip(RoundedCornerShape(radius))
            .background(Color.Black.copy(alpha = 0.55f))
            .clickable(onClickLabel = "Voir le produit", onClick = onOpen)
            .padding(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ProductThumbnail(product.imageUrl, Modifier.size(44.dp))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f, fill = false)) {
            Text(product.name, color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(formatPrice(product.price, product.currency), color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp)
        }
        Spacer(Modifier.width(8.dp))
        Text(
            "Acheter",
            color = MaterialTheme.colorScheme.onPrimary,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
            modifier = Modifier
                .clip(RoundedCornerShape(radius))
                .background(MaterialTheme.colorScheme.primary)
                .padding(horizontal = 10.dp, vertical = 6.dp),
        )
    }
}

@Composable
internal fun ProductThumbnail(imageUrl: String?, modifier: Modifier) {
    val shape = RoundedCornerShape(LocalLiveTheme.current.cornerRadius / 2)
    Box(modifier.clip(shape).background(MaterialTheme.colorScheme.surfaceVariant), Alignment.Center) {
        if (imageUrl == null) {
            Text("🛍", fontSize = 20.sp)
        } else {
            AsyncImage(imageUrl, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
        }
    }
}

// ------------------------------------------------------------------ fiche et Achat

/**
 * La fiche du Produit épinglé et « Confirmer l'achat » (simulé). Si l'Animateur change de produit
 * entre-temps (`product_changed`), la fiche montre le nouveau et demande de confirmer à nouveau.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ProductSheet(live: Live, onDismiss: () -> Unit) {
    val state by live.state.collectAsStateWithLifecycle()
    val product = state.live?.pinnedProduct
    val scope = rememberCoroutineScope()
    // Le produit que le Spectateur a vu : celui de l'ouverture, ou du dernier « Confirmer l'achat ».
    var seenId by remember { mutableStateOf(product?.id) }
    var buying by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // `product_changed` reçu : expliqué même si le nouveau `productPinned` n'est pas encore arrivé.
    var refused by remember { mutableStateOf(false) }
    val changed = refused || (product != null && product.id != seenId)

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
            if (product == null) {
                Text("Produit", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                Text(
                    if (refused) "Le produit a été retiré avant votre achat : rien n'a été acheté." else "Ce produit n'est plus proposé.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                return@Column
            }
            if (changed) {
                Notice("Le produit vient de changer : rien n'a été acheté. Vérifiez-le avant de confirmer.")
                Spacer(Modifier.height(12.dp))
            }
            ProductThumbnail(product.imageUrl, Modifier.fillMaxWidth().aspectRatio(1.6f))
            Spacer(Modifier.height(12.dp))
            Text(product.name, style = MaterialTheme.typography.titleLarge)
            Text(
                formatPrice(product.price, product.currency),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "Achat simulé : rien n'est débité. Il sera annoncé dans le chat.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 13.sp,
            )
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
            }
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = {
                    buying = true
                    error = null
                    refused = false
                    seenId = product.id
                    scope.launch {
                        when (val result = live.purchase(product.id)) {
                            is LiveResult.Success -> onDismiss()
                            // `product_changed` : avertissement, puis le nouveau produit dès son `productPinned`,
                            // qui attend une nouvelle confirmation.
                            is LiveResult.Failure -> if (result.error.code == LiveErrorCode.ProductChanged) {
                                refused = true
                            } else {
                                error = result.error.displayMessage()
                            }
                        }
                        buying = false
                    }
                },
                enabled = !buying,
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) {
                if (buying) InlineProgress() else Text("Confirmer l'achat")
            }
        }
    }
}

@Composable
private fun Notice(text: String) {
    Text(
        text,
        color = MaterialTheme.colorScheme.onTertiaryContainer,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(LocalLiveTheme.current.cornerRadius))
            .background(MaterialTheme.colorScheme.tertiaryContainer)
            .padding(12.dp),
    )
}

@Composable
internal fun InlineProgress() {
    CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary)
}

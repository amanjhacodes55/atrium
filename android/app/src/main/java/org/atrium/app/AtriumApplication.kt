package org.atrium.app

import android.app.Application
import org.atrium.app.data.ApiClient
import org.atrium.app.data.AtriumRepository

/** Holds the app's single repository; small enough that a DI framework would be overkill. */
class AtriumApplication : Application() {
    lateinit var repository: AtriumRepository
        private set

    override fun onCreate() {
        super.onCreate()
        repository = AtriumRepository(ApiClient(BuildConfig.BASE_URL), BuildConfig.BASE_URL)
    }
}

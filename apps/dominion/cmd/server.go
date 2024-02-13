package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// Serve uses the arguments to create a HTTPS server that uses secure defaults and has gracefully shutdown support
func serve(addr string, httpsCertPath string, httpsKeyPath string, caCertPool *x509.CertPool, r http.Handler) {
	var tlsConfig = &tls.Config{
		// Standards from https://wiki.mozilla.org/Security/Server_Side_TLS
		// MinVersion: tls.VersionTLS12,
	}

	if caCertPool != nil {
		tlsConfig.ClientCAs = caCertPool
		tlsConfig.ClientAuth = tls.RequireAndVerifyClientCert
	}

	var srv = &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
		TLSConfig:         tlsConfig,
	}

	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		if err := srv.ListenAndServeTLS(httpsCertPath, httpsKeyPath); err != nil && err != http.ErrServerClosed {
			log.Fatal("[Error] Server encountered an error:", err)
		}
	}()
	log.Println("Listening at '" + addr + "'")

	<-done
	log.Println("Finishing active connections. Please wait...")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil && err != http.ErrServerClosed {
		log.Fatal("[Error] Failed to shutdown server:", err)
	}
}

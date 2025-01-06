/// GetNextCACert(ctx context.Context) ([]byte, error)
pub trait Service {
    //    // GetCACaps returns a list of options
    // // which are supported by the server.
    // GetCACaps(ctx context.Context) ([]byte, error)

    // // GetCACert returns CA certificate or
    // // a CA certificate chain with intermediates
    // // in a PKCS#7 Degenerate Certificates format
    // // message is an optional string for the CA
    // GetCACert(ctx context.Context, message string) ([]byte, int, error)

    // // PKIOperation handles incoming SCEP messages such as PKCSReq and
    // // sends back a CertRep PKIMessag.
    // PKIOperation(ctx context.Context, msg []byte) ([]byte, error)

    // // GetNextCACert returns a replacement certificate or certificate chain
    // // when the old one expires. The response format is a PKCS#7 Degenerate
    // // Certificates type.
    // GetNextCACert(ctx context.Context) ([]byte, error)
}

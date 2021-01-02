package http_api

// func Object(srv *mattrax.Server) http.HandlerFunc {
// 	return func(w http.ResponseWriter, r *http.Request) {
// 		tx := middleware.DBTxFromContext(r.Context())
// 		span := zipkin.SpanOrNoopFromContext(r.Context())
// 		vars := mux.Vars(r)

// 		if r.Method == http.MethodGet {
// 			object, err := srv.DB.WithTx(tx).GetObject(r.Context(), db.GetObjectParams{
// 				ID:       vars["oid"],
// 				TenantID: vars["tenant"],
// 			})
// 			if err == sql.ErrNoRows {
// 				span.Tag("warn", "object not found")
// 				w.WriteHeader(http.StatusNotFound)
// 				return
// 			} else if err != nil {
// 				log.Printf("[GetObject Error]: %s\n", err)
// 				span.Tag("err", fmt.Sprintf("error retrieving object: %s", err))
// 				w.WriteHeader(http.StatusInternalServerError)
// 				return
// 			}

// 			w.Header().Add("X-Filename", object.Filename.String)
// 			w.Write(object.Data)
// 		} else if r.Method == http.MethodPost {
// 			if err := r.ParseMultipartForm(1024 << 20); err != nil {
// 				panic(err) // TODO
// 			}

// 			file, handler, err := r.FormFile("file")
// 			if err != nil {
// 				panic(err) // TODO
// 				return
// 			}
// 			defer file.Close()

// 			fileBytes, err := ioutil.ReadAll(file)
// 			if err != nil {
// 				fmt.Println(err)
// 			}

// 			if err := srv.DB.WithTx(tx).UpdateObject(r.Context(), db.UpdateObjectParams{
// 				ID:       vars["oid"],
// 				TenantID: vars["tenant"],
// 				Filename: null.String{
// 					String: handler.Filename,
// 					Valid:  true,
// 				},
// 				Data: fileBytes,
// 			}); err == sql.ErrNoRows {
// 				span.Tag("warn", "object not found")
// 				w.WriteHeader(http.StatusNotFound)
// 				return
// 			} else if err != nil {
// 				log.Printf("[GetObject Error]: %s\n", err)
// 				span.Tag("err", fmt.Sprintf("error retrieving object: %s", err))
// 				w.WriteHeader(http.StatusInternalServerError)
// 				return
// 			}

// 			w.WriteHeader(http.StatusNoContent)
// 		}
// 	}
// }
